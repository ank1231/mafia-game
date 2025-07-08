const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// 봇 AI 시스템
class BotAI {
    constructor() {
        this.gameHistory = new Map(); // roomCode -> history
    }

    initializeRoomHistory(roomCode) {
        if (!this.gameHistory.has(roomCode)) {
            this.gameHistory.set(roomCode, {
                rounds: [],
                currentRound: {
                    nightActions: {},
                    votes: {},
                    deaths: [],
                    investigations: []
                },
                suspicionLevels: new Map(), // playerId -> suspicion score
                trustLevels: new Map(), // playerId -> trust score
                roleGuesses: new Map(), // playerId -> suspected role
                behaviorPatterns: new Map(), // playerId -> behavior data
                chatHistory: [], // 모든 채팅 메시지 히스토리
                playerStatements: new Map() // playerId -> 발언 패턴 데이터
            });
        }
    }

    // 채팅 메시지 저장
    addChatMessage(roomCode, messageData, room = null) {
        const history = this.gameHistory.get(roomCode);
        if (!history) return;

        const chatMessage = {
            id: Date.now() + Math.random(), // 고유 ID
            timestamp: new Date(),
            round: messageData.round || 0,
            gamePhase: messageData.gamePhase || 'lobby',
            type: messageData.type, // 'system', 'player', 'dead'
            playerId: messageData.playerId,
            playerName: messageData.playerName,
            message: messageData.message,
            analyzed: false // 분석 완료 여부
        };

        history.chatHistory.push(chatMessage);

        // 플레이어 발언인 경우 개별 발언 데이터 업데이트
        if (messageData.type === 'player' && messageData.playerId) {
            this.updatePlayerStatements(roomCode, messageData.playerId, chatMessage, room);
        }

        console.log(`[채팅 히스토리] 메시지 저장: ${messageData.playerName || '시스템'}: ${messageData.message}`);
    }

    // 플레이어별 발언 패턴 데이터 업데이트
    updatePlayerStatements(roomCode, playerId, chatMessage, room = null) {
        const history = this.gameHistory.get(roomCode);
        if (!history) return;

        if (!history.playerStatements.has(playerId)) {
            history.playerStatements.set(playerId, {
                totalMessages: 0,
                suspicionClaims: [], // "○○○이 의심스럽다" 류의 발언
                trustClaims: [], // "○○○을 믿는다" 류의 발언
                roleClaims: [], // "나는 시민이다" 류의 발언
                informationClaims: [], // "내가 조사했는데..." 류의 발언
                defensiveStatements: [], // 방어적 발언
                contradictions: [], // 모순 발언
                messageTimings: [], // 발언 타이밍
                reactionPatterns: [] // 반응 패턴
            });
        }

        const playerData = history.playerStatements.get(playerId);
        playerData.totalMessages++;
        playerData.messageTimings.push({
            timestamp: chatMessage.timestamp,
            round: chatMessage.round,
            phase: chatMessage.gamePhase
        });

        // 발언 내용 분석
        this.analyzeChatMessage(chatMessage, playerData, room);
    }

    // 채팅 메시지 분석 (거짓말 탐지 및 진실 찾기)
    analyzeChatMessage(chatMessage, playerData, room = null) {
        const message = chatMessage.message.toLowerCase();
        
        // 1. 의심 표현 탐지
        if (this.containsSuspicionExpression(message)) {
            const suspectedPlayer = this.extractPlayerName(message, room);
            if (suspectedPlayer) {
                playerData.suspicionClaims.push({
                    target: suspectedPlayer,
                    message: chatMessage.message,
                    timestamp: chatMessage.timestamp,
                    round: chatMessage.round,
                    phase: chatMessage.gamePhase
                });
                console.log(`[의심 표현] ${chatMessage.playerName}: ${suspectedPlayer}를 의심`);
            }
        }

        // 2. 신뢰 표현 탐지
        if (this.containsTrustExpression(message)) {
            const trustedPlayer = this.extractPlayerName(message, room);
            if (trustedPlayer) {
                playerData.trustClaims.push({
                    target: trustedPlayer,
                    message: chatMessage.message,
                    timestamp: chatMessage.timestamp,
                    round: chatMessage.round,
                    phase: chatMessage.gamePhase
                });
                console.log(`[신뢰 표현] ${chatMessage.playerName}: ${trustedPlayer}를 신뢰`);
            }
        }

        // 3. 역할 주장 탐지
        if (this.containsRoleClaim(message)) {
            const claimedRole = this.extractRoleClaim(message);
            if (claimedRole) {
                playerData.roleClaims.push({
                    role: claimedRole,
                    message: chatMessage.message,
                    timestamp: chatMessage.timestamp,
                    round: chatMessage.round,
                    phase: chatMessage.gamePhase
                });
                console.log(`[역할 주장] ${chatMessage.playerName}: ${claimedRole} 주장`);
            }
        }

        // 4. 정보 주장 탐지 (경찰 조사 결과 등)
        if (this.containsInformationClaim(message)) {
            const information = this.extractInformationClaim(message);
            if (information) {
                playerData.informationClaims.push({
                    type: information.type,
                    target: information.target,
                    result: information.result,
                    message: chatMessage.message,
                    timestamp: chatMessage.timestamp,
                    round: chatMessage.round,
                    phase: chatMessage.gamePhase
                });
                console.log(`[정보 주장] ${chatMessage.playerName}: ${information.type} 정보 주장`);
            }
        }

        // 5. 방어적 발언 탐지
        if (this.containsDefensiveStatement(message)) {
            playerData.defensiveStatements.push({
                message: chatMessage.message,
                timestamp: chatMessage.timestamp,
                round: chatMessage.round,
                phase: chatMessage.gamePhase
            });
            console.log(`[방어적 발언] ${chatMessage.playerName}: 방어적 발언 감지`);
        }
    }

    // 의심 표현 탐지
    containsSuspicionExpression(message) {
        const suspicionKeywords = [
            '의심', '수상', '마피아', '범인', '거짓말', '이상', '수상해', '의심스럽',
            '못믿', '안믿', '틀렸', '거짓', '가짜', '속이', '의심돼', '맞을 것 같', '아닌 것 같',
            '이상하', '수상하', '몰라서', '뭔가 이상', '느낌이 안 좋', '느낌이 나쁜'
        ];
        
        return suspicionKeywords.some(keyword => message.includes(keyword));
    }

    // 신뢰 표현 탐지
    containsTrustExpression(message) {
        const trustKeywords = [
            '믿는다', '믿어', '신뢰', '믿을 만', '깨끗', '시민', '무고', '진짜', '확실',
            '맞는 것 같', '진실', '정말', '진짜인 것 같', '확실한 것 같', '깨끗한 것 같',
            '시민인 것 같', '무고한 것 같', '의심 안 가', '의심 안 됨'
        ];
        
        return trustKeywords.some(keyword => message.includes(keyword));
    }

    // 역할 주장 탐지
    containsRoleClaim(message) {
        const roleKeywords = ['시민', '마피아', '경찰', '의사', '나는', '내가', '역할'];
        return roleKeywords.some(keyword => message.includes(keyword));
    }

    // 정보 주장 탐지 (경찰 조사 결과 등)
    containsInformationClaim(message) {
        const informationKeywords = [
            '조사', '수사', '치료', '보호', '결과', '확인', '알아봤', '봤는데',
            '조사했', '수사했', '치료했', '보호했', '확인했', '알아보니'
        ];
        
        return informationKeywords.some(keyword => message.includes(keyword));
    }

    // 방어적 발언 탐지
    containsDefensiveStatement(message) {
        const defensiveKeywords = [
            '아니', '아니다', '아님', '아닙니다', '틀렸', '잘못', '오해', '억울',
            '진짜 아니', '정말 아니', '절대 아니', '왜 나를', '나는 안', '나는 정말',
            '오해하지 마', '믿어달라', '정말이야', '거짓말 아니', '사실이야'
        ];
        
        return defensiveKeywords.some(keyword => message.includes(keyword));
    }

    // 메시지에서 플레이어 이름 추출
    extractPlayerName(message, room) {
        if (!room) return null;
        
        // 현재 방의 모든 플레이어 이름 목록
        const allPlayerNames = [];
        for (const player of room.players.values()) {
            allPlayerNames.push(player.name.toLowerCase());
        }
        for (const bot of room.bots.values()) {
            allPlayerNames.push(bot.name.toLowerCase());
        }
        
        // 메시지에서 플레이어 이름 찾기
        const lowerMessage = message.toLowerCase();
        for (const playerName of allPlayerNames) {
            if (lowerMessage.includes(playerName)) {
                return playerName;
            }
        }
        
        return null;
    }

    // 역할 주장 추출
    extractRoleClaim(message) {
        if (message.includes('시민')) return 'citizen';
        if (message.includes('경찰')) return 'police';
        if (message.includes('의사')) return 'doctor';
        if (message.includes('마피아')) return 'mafia';
        if (message.includes('마법사')) return 'wizard';
        return null;
    }

    // 정보 주장 추출
    extractInformationClaim(message) {
        if (message.includes('조사')) {
            return {
                type: 'investigation',
                target: null, // 추후 구현
                result: null // 추후 구현
            };
        }
        if (message.includes('치료') || message.includes('보호')) {
            return {
                type: 'healing',
                target: null, // 추후 구현
                result: null
            };
        }
        return null;
    }

    // === 거짓말 탐지 및 진실 분석 시스템 ===

    // 플레이어의 채팅 기반 신뢰도 계산
    calculateChatTrust(playerId, history, room) {
        const playerStatements = history.playerStatements.get(playerId);
        if (!playerStatements) return 0; // 채팅 안 한 플레이어는 중립

        let chatTrust = 0;
        
        // 1. 발언 일관성 분석 (거짓말쟁이는 모순 발언을 한다)
        chatTrust += this.analyzeStatementConsistency(playerId, playerStatements, history);
        
        // 2. 행동과 발언 일치성 분석 (말과 행동이 다르면 거짓말)
        chatTrust += this.analyzeActionStatementAlignment(playerId, playerStatements, history, room);
        
        // 3. 정보 주장의 정확성 검증 (거짓 정보를 퍼뜨리는지)
        chatTrust += this.verifyInformationClaims(playerId, playerStatements, history, room);
        
        // 4. 과도한 주장/확신 탐지 (마피아는 과도하게 확신하는 경향)
        chatTrust += this.analyzeExcessiveConfidence(playerId, playerStatements);
        
        // 5. 방어 패턴 분석 (과도한 방어는 의심스러움)
        chatTrust += this.analyzeDefensivePatterns(playerId, playerStatements);
        
        // 6. 타이밍과 반응 패턴 분석 (언제 말하고 어떻게 반응하는지)
        chatTrust += this.analyzeTimingAndReactions(playerId, playerStatements, history);

        console.log(`[채팅 분석] ${playerId}: 채팅 신뢰도 ${chatTrust}점`);
        return Math.max(-50, Math.min(50, chatTrust)); // -50 ~ +50 점 범위
    }

    // 1. 발언 일관성 분석 (전후 발언이 모순되는지)
    analyzeStatementConsistency(playerId, playerStatements, history) {
        let consistency = 0;
        
        // 역할 주장의 일관성 체크
        const roleClaims = playerStatements.roleClaims;
        if (roleClaims.length > 1) {
            // 여러 번 다른 역할을 주장했다면 의심
            const claimedRoles = new Set(roleClaims.map(claim => claim.role));
            if (claimedRoles.size > 1) {
                consistency -= 15; // 역할 주장 모순
                console.log(`[일관성] ${playerId}: 역할 주장 모순 (-15)`);
            }
        }

        // 의심 표현의 일관성 체크
        const suspicionClaims = playerStatements.suspicionClaims;
        const trustClaims = playerStatements.trustClaims;
        
        // 같은 플레이어를 의심했다가 신뢰한다고 했다면 모순
        for (const suspicion of suspicionClaims) {
            const laterTrust = trustClaims.find(trust => 
                trust.target === suspicion.target && 
                trust.timestamp > suspicion.timestamp
            );
            if (laterTrust) {
                consistency -= 10; // 의심/신뢰 모순
                console.log(`[일관성] ${playerId}: ${suspicion.target}에 대한 의심/신뢰 모순 (-10)`);
            }
        }

        return consistency;
    }

    // 2. 행동과 발언 일치성 분석
    analyzeActionStatementAlignment(playerId, playerStatements, history, room) {
        let alignment = 0;
        
        // 투표와 의심 표현 일치성
        for (const round of history.rounds) {
            const votedTarget = round.votes[playerId];
            if (votedTarget) {
                // 그 라운드에서 의심 표현을 한 대상과 투표 대상이 일치하는지
                const roundSuspicions = playerStatements.suspicionClaims.filter(claim => 
                    claim.round === round.round && claim.target === votedTarget
                );
                
                if (roundSuspicions.length > 0) {
                    alignment += 5; // 말과 행동 일치
                    console.log(`[행동일치] ${playerId}: R${round.round} 의심표현-투표 일치 (+5)`);
                }

                // 신뢰한다고 했는데 투표했다면 모순
                const roundTrusts = playerStatements.trustClaims.filter(claim => 
                    claim.round === round.round && claim.target === votedTarget
                );
                
                if (roundTrusts.length > 0) {
                    alignment -= 10; // 말과 행동 모순
                    console.log(`[행동일치] ${playerId}: R${round.round} 신뢰표현-투표 모순 (-10)`);
                }
            }
        }

        return alignment;
    }

    // 3. 정보 주장의 정확성 검증
    verifyInformationClaims(playerId, playerStatements, history, room) {
        let accuracy = 0;
        
        // 경찰 조사 결과 주장 검증
        for (const claim of playerStatements.informationClaims) {
            if (claim.type === 'investigation') {
                // 실제 조사 결과와 비교
                const actualInvestigation = this.findActualInvestigation(playerId, claim, history);
                if (actualInvestigation) {
                    if (actualInvestigation.result === claim.result) {
                        accuracy += 15; // 정확한 정보 제공
                        console.log(`[정보검증] ${playerId}: 정확한 조사 정보 (+15)`);
                    } else {
                        accuracy -= 20; // 거짓 정보 제공
                        console.log(`[정보검증] ${playerId}: 거짓 조사 정보 (-20)`);
                    }
                } else {
                    // 조사하지 않았는데 조사 결과를 알고 있다고 주장
                    accuracy -= 25; // 불가능한 정보 주장
                    console.log(`[정보검증] ${playerId}: 불가능한 조사 정보 (-25)`);
                }
            }
        }

        return accuracy;
    }

    // 4. 과도한 주장/확신 탐지
    analyzeExcessiveConfidence(playerId, playerStatements) {
        let confidence = 0;
        
        const totalMessages = playerStatements.totalMessages;
        const suspicionClaims = playerStatements.suspicionClaims.length;
        const trustClaims = playerStatements.trustClaims.length;
        const roleClaims = playerStatements.roleClaims.length;
        
        // 너무 많은 의심/신뢰 표현 (전체 메시지 대비)
        if (totalMessages > 0) {
            const opinionRatio = (suspicionClaims + trustClaims) / totalMessages;
            if (opinionRatio > 0.7) { // 70% 이상이 의견 표현
                confidence -= 8; // 과도한 의견 표현
                console.log(`[과도한확신] ${playerId}: 과도한 의견 표현 (-8)`);
            }
        }

        // 너무 많은 역할 주장
        if (roleClaims > 2) {
            confidence -= 5; // 과도한 역할 주장
            console.log(`[과도한확신] ${playerId}: 과도한 역할 주장 (-5)`);
        }

        return confidence;
    }

    // 5. 방어 패턴 분석
    analyzeDefensivePatterns(playerId, playerStatements) {
        let defense = 0;
        
        const defensiveCount = playerStatements.defensiveStatements.length;
        const totalMessages = playerStatements.totalMessages;
        
        if (totalMessages > 0) {
            const defensiveRatio = defensiveCount / totalMessages;
            
            if (defensiveRatio > 0.4) { // 40% 이상이 방어적 발언
                defense -= 10; // 과도한 방어
                console.log(`[방어패턴] ${playerId}: 과도한 방어적 발언 (-10)`);
            } else if (defensiveRatio > 0.2) { // 20% 이상이 방어적 발언
                defense -= 5; // 약간의 방어
                console.log(`[방어패턴] ${playerId}: 방어적 성향 (-5)`);
            }
        }

        return defense;
    }

    // 6. 타이밍과 반응 패턴 분석
    analyzeTimingAndReactions(playerId, playerStatements, history) {
        let timing = 0;
        
        const messageTimings = playerStatements.messageTimings;
        
        // 토론 시간 활용 패턴
        const discussionMessages = messageTimings.filter(msg => msg.phase === 'discussion');
        if (discussionMessages.length === 0 && playerStatements.totalMessages > 0) {
            timing -= 5; // 토론 시간에 참여하지 않음
            console.log(`[타이밍] ${playerId}: 토론 시간 비참여 (-5)`);
        }

        // 투표 직전 발언 패턴 (마피아는 투표 직전에 의견을 바꾸는 경향)
        const lastMinuteMessages = discussionMessages.filter(msg => {
            // 토론 시간 마지막 10초 내 발언
            return msg.phase === 'discussion'; // 실제로는 시간 계산 필요
        });
        
        if (lastMinuteMessages.length > discussionMessages.length * 0.5) {
            timing -= 3; // 대부분 마지막에 발언
            console.log(`[타이밍] ${playerId}: 마지막 순간 발언 편중 (-3)`);
        }

        return timing;
    }

    // 실제 조사 결과 찾기
    findActualInvestigation(playerId, claim, history) {
        for (const round of history.rounds) {
            const investigation = round.investigations.find(inv => 
                inv.investigator === playerId && 
                inv.target === claim.target
            );
            if (investigation) return investigation;
        }
        return null;
    }

    // 게임 상황 분석
    analyzeGameState(room) {
        const history = this.gameHistory.get(room.code);
        if (!history) return null;

        const alivePlayers = this.getAlivePlayers(room);
        const analysis = {
            alivePlayers,
            mafiaCount: this.estimateMafiaCount(alivePlayers.length),
            suspiciousPlayers: this.getMostSuspiciousPlayers(history, alivePlayers),
            trustedPlayers: this.getMostTrustedPlayers(history, alivePlayers, room),
            threats: this.identifyThreats(history, alivePlayers),
            protectionTargets: this.identifyProtectionTargets(history, alivePlayers, room)
        };

        return analysis;
    }

    // 마피아 수 추정
    estimateMafiaCount(totalPlayers) {
        return Math.floor(totalPlayers / 3);
    }

    // 의심도 계산
    calculateSuspicion(playerId, history) {
        let suspicion = 0;
        
        // 투표 패턴 분석
        suspicion += this.analyzeVotingPattern(playerId, history);
        
        // 생존율 분석 (오래 살아남은 플레이어는 의심도 증가)
        suspicion += this.analyzeSurvivalRate(playerId, history);
        
        // 행동 일관성 분석
        suspicion += this.analyzeBehaviorConsistency(playerId, history);

        return Math.max(0, Math.min(100, suspicion));
    }

    // 투표 패턴 분석
    analyzeVotingPattern(playerId, history) {
        let suspicion = 0;
        const rounds = history.rounds;
        
        // 죽은 플레이어에게 투표하지 않은 경우 의심도 증가
        for (const round of rounds) {
            if (round.votes[playerId] && round.eliminated) {
                const votedPlayer = round.votes[playerId];
                const eliminatedPlayer = round.eliminated;
                
                // 마피아가 처형되었을 때 그에게 투표하지 않았다면 의심
                if (eliminatedPlayer.role === 'mafia' && votedPlayer !== eliminatedPlayer.id) {
                    suspicion += 15;
                }
            }
        }
        
        return suspicion;
    }

    // 생존율 분석
    analyzeSurvivalRate(playerId, history) {
        const rounds = history.rounds.length;
        if (rounds <= 2) return 0;
        
        // 게임 후반까지 살아남은 플레이어는 약간 의심
        return Math.min(10, rounds * 2);
    }

    // 행동 일관성 분석
    analyzeBehaviorConsistency(playerId, history) {
        // 향후 채팅 로그 분석 등을 위한 확장 포인트
        return 0;
    }

    // 가장 의심스러운 플레이어들 반환
    getMostSuspiciousPlayers(history, alivePlayers) {
        const suspicions = [];
        
        for (const player of alivePlayers) {
            const suspicion = this.calculateSuspicion(player.id, history);
            suspicions.push({ player, suspicion });
        }
        
        return suspicions.sort((a, b) => b.suspicion - a.suspicion);
    }

    // 가장 신뢰할 만한 플레이어들 반환
    getMostTrustedPlayers(history, alivePlayers, room = null) {
        const trusted = [];
        
        for (const player of alivePlayers) {
            const trust = this.calculateTrust(player.id, history, room);
            trusted.push({ player, trust });
        }
        
        return trusted.sort((a, b) => b.trust - a.trust);
    }

    // 신뢰도 계산 (역할 정보 없이 추리)
    calculateTrust(playerId, history, room = null) {
        let trust = 50; // 기본 신뢰도
        
        // 1. 밤 생존 패턴 분석 (마피아는 밤에 죽지 않는 경향)
        trust += this.analyzeNightSurvival(playerId, history);
        
        // 2. 투표 패턴 분석 (밤에 죽은 플레이어와의 관계)
        trust += this.analyzeVotingPatterns(playerId, history);
        
        // 3. 경찰 조사 결과 활용 (자신이 경찰인 경우에만)
        trust += this.analyzeInvestigationResults(playerId, history);
        
        // 4. 공격 대상 패턴 분석 (누가 밤에 죽었는지)
        trust += this.analyzeAttackPatterns(playerId, history);
        
        // 5. 📢 채팅 분석 (거짓말 탐지 및 진실 분석)
        if (room) {
            const chatTrust = this.calculateChatTrust(playerId, history, room);
            trust += chatTrust;
            console.log(`[종합 신뢰도] ${playerId}: 기본 ${trust - chatTrust}점 + 채팅 ${chatTrust}점 = 총 ${trust}점`);
        }
        
        return Math.max(0, Math.min(100, trust));
    }
    
    // 밤 생존 패턴 분석
    analyzeNightSurvival(playerId, history) {
        let survival = 0;
        let nightsAlive = 0;
        let totalNights = 0;
        
        for (const round of history.rounds) {
            if (round.nightDeaths && round.nightDeaths.length > 0) {
                totalNights++;
                // 밤에 죽지 않고 살아남은 경우
                if (!round.nightDeaths.includes(playerId)) {
                    nightsAlive++;
                }
            }
        }
        
        // 마피아는 밤에 죽지 않는 특성 활용
        if (totalNights > 0) {
            const survivalRate = nightsAlive / totalNights;
            
            // 너무 높은 생존율은 의심스러움 (마피아일 가능성)
            if (survivalRate === 1.0 && totalNights > 2) {
                survival -= 5; // 모든 밤을 살아남은 경우 약간 의심
            } else if (survivalRate > 0.7) {
                survival += 2; // 적당히 높은 생존율은 신뢰도 증가
            }
        }
        
        return survival;
    }
    
    // 투표 패턴 분석 (밤에 죽은 플레이어와의 관계)
    analyzeVotingPatterns(playerId, history) {
        let patterns = 0;
        
        for (const round of history.rounds) {
            if (round.nightDeaths && round.nightDeaths.length > 0) {
                const nightVictim = round.nightDeaths[0]; // 밤에 죽은 플레이어
                
                // 이전 라운드에서 밤에 죽은 플레이어와 투표 관계 분석
                const prevRoundIndex = history.rounds.indexOf(round) - 1;
                if (prevRoundIndex >= 0) {
                    const prevRound = history.rounds[prevRoundIndex];
                    
                    // 밤에 죽은 플레이어에게 투표했다면 의심도 증가
                    if (prevRound.votes[playerId] === nightVictim) {
                        patterns -= 3; // 밤에 죽은 사람을 투표했으면 약간 의심
                    }
                    
                    // 밤에 죽은 플레이어가 자신에게 투표했다면 신뢰도 증가
                    if (prevRound.votes[nightVictim] === playerId) {
                        patterns += 5; // 희생자가 자신을 의심했다면 무고할 가능성
                    }
                }
            }
        }
        
        return patterns;
    }
    
    // 경찰 조사 결과 활용 (자신이 경찰인 경우에만)
    analyzeInvestigationResults(playerId, history) {
        let investigation = 0;
        
        for (const round of history.rounds) {
            if (round.investigations && round.investigations.length > 0) {
                for (const inv of round.investigations) {
                    if (inv.target === playerId) {
                        // 경찰이 조사한 결과가 'not_mafia'라면 신뢰도 대폭 증가
                        if (inv.result === 'not_mafia') {
                            investigation += 30;
                        }
                        // 경찰이 조사한 결과가 'mafia'라면 신뢰도 대폭 감소
                        else if (inv.result === 'mafia') {
                            investigation -= 40;
                        }
                    }
                }
            }
        }
        
        return investigation;
    }
    
    // 공격 대상 패턴 분석
    analyzeAttackPatterns(playerId, history) {
        let patterns = 0;
        
        // 밤에 죽은 플레이어들의 패턴 분석
        const nightVictims = [];
        for (const round of history.rounds) {
            if (round.nightDeaths && round.nightDeaths.length > 0) {
                nightVictims.push(...round.nightDeaths);
            }
        }
        
        // 공격 대상들과의 관계 분석
        for (const victim of nightVictims) {
            // 과거 투표에서 피해자와 대립했는지 확인
            for (const round of history.rounds) {
                if (round.votes[playerId] === victim) {
                    patterns -= 2; // 공격 받은 사람을 투표했다면 약간 의심
                }
                if (round.votes[victim] === playerId) {
                    patterns += 3; // 공격 받은 사람이 자신을 의심했다면 무고할 가능성
                }
            }
        }
        
        return patterns;
    }

    // 위협 식별
    identifyThreats(history, alivePlayers) {
        const threats = [];
        
        for (const player of alivePlayers) {
            const suspicion = this.calculateSuspicion(player.id, history);
            if (suspicion > 60) {
                threats.push({ player, level: 'high', suspicion });
            } else if (suspicion > 40) {
                threats.push({ player, level: 'medium', suspicion });
            }
        }
        
        return threats.sort((a, b) => b.suspicion - a.suspicion);
    }

    // 보호 대상 식별
    identifyProtectionTargets(history, alivePlayers, room = null) {
        const targets = [];
        
        for (const player of alivePlayers) {
            const trust = this.calculateTrust(player.id, history, room);
            const suspicion = this.calculateSuspicion(player.id, history);
            
            // 신뢰도 높고 의심도 낮은 플레이어
            if (trust > 70 && suspicion < 30) {
                targets.push({ player, priority: 'high', trust, suspicion });
            } else if (trust > 50 && suspicion < 50) {
                targets.push({ player, priority: 'medium', trust, suspicion });
            }
        }
        
        return targets.sort((a, b) => b.trust - a.trust);
    }

    // 라운드 종료 시 히스토리 업데이트
    updateRoundHistory(room, roundData) {
        const history = this.gameHistory.get(room.code);
        if (!history) return;

        history.rounds.push({
            round: room.round,
            votes: { ...roundData.votes },
            eliminated: roundData.eliminated,
            nightDeaths: roundData.nightDeaths || [],
            investigations: roundData.investigations || []
        });

        // 의심도 업데이트
        this.updateSuspicionLevels(room, roundData);
    }

    // 의심도 레벨 업데이트
    updateSuspicionLevels(room, roundData) {
        const history = this.gameHistory.get(room.code);
        if (!history) return;

        const alivePlayers = this.getAlivePlayers(room);
        
        for (const player of alivePlayers) {
            const suspicion = this.calculateSuspicion(player.id, history);
            history.suspicionLevels.set(player.id, suspicion);
        }
    }

    // 살아있는 플레이어 목록 반환
    getAlivePlayers(room) {
        const alivePlayers = [];
        
        for (const player of room.players.values()) {
            if (player.alive) alivePlayers.push(player);
        }
        
        for (const bot of room.bots.values()) {
            if (bot.alive) alivePlayers.push(bot);
        }
        
        return alivePlayers;
    }

    // 게임 리셋 시 히스토리 초기화
    resetGameHistory(roomCode) {
        this.gameHistory.delete(roomCode);
    }

    // === 역할별 전략 로직 ===

    // 마피아 봇 전략
    chooseMafiaTarget(room, mafiaBot) {
        const analysis = this.analyzeGameState(room);
        if (!analysis) return this.chooseRandomTarget(room, mafiaBot, 'mafia');

        console.log(`[마피아 AI] ${mafiaBot.name}: 전략적 대상 선택 시작`);

        // 우선순위 1: 위험한 역할 (경찰, 의사로 추정되는 플레이어)
        const threats = analysis.threats.filter(t => 
            t.player.id !== mafiaBot.id && 
            this.getPlayerRole(room, t.player.id) !== 'mafia'
        );

        if (threats.length > 0) {
            const target = threats[0].player;
            console.log(`[마피아 AI] ${mafiaBot.name}: 위험 인물 ${target.name} 선택 (의심도: ${threats[0].suspicion})`);
            return target;
        }

        // 우선순위 2: 신뢰도가 높은 플레이어 (시민 진영으로 보이는 플레이어)
        const trustedPlayers = analysis.trustedPlayers.filter(p => 
            p.player.id !== mafiaBot.id && 
            this.getPlayerRole(room, p.player.id) !== 'mafia'
        );

        if (trustedPlayers.length > 0) {
            const target = trustedPlayers[0].player;
            console.log(`[마피아 AI] ${mafiaBot.name}: 신뢰받는 플레이어 ${target.name} 선택 (신뢰도: ${trustedPlayers[0].trust})`);
            return target;
        }

        // 우선순위 3: 무작위 선택 (마피아 제외)
        console.log(`[마피아 AI] ${mafiaBot.name}: 전략적 대상 없음, 무작위 선택`);
        return this.chooseRandomTarget(room, mafiaBot, 'mafia');
    }

    // 의사 봇 전략
    chooseDoctorTarget(room, doctorBot) {
        const analysis = this.analyzeGameState(room);
        if (!analysis) return this.chooseRandomTarget(room, doctorBot, 'doctor');

        console.log(`[의사 AI] ${doctorBot.name}: 전략적 보호 대상 선택 시작`);

        // 우선순위 1: 보호 우선순위가 높은 플레이어 (자신 제외)
        const protectionTargets = analysis.protectionTargets.filter(t => t.player.id !== doctorBot.id);
        if (protectionTargets.length > 0) {
            const target = protectionTargets[0].player;
            console.log(`[의사 AI] ${doctorBot.name}: 보호 우선순위 플레이어 ${target.name} 선택 (신뢰도: ${protectionTargets[0].trust})`);
            return target;
        }

        // 우선순위 2: 신뢰도가 높은 플레이어 보호 (자신 제외)
        const trustedPlayers = analysis.trustedPlayers.filter(p => p.player.id !== doctorBot.id);
        if (trustedPlayers.length > 0) {
            const target = trustedPlayers[0].player;
            console.log(`[의사 AI] ${doctorBot.name}: 신뢰받는 플레이어 ${target.name} 보호 선택 (신뢰도: ${trustedPlayers[0].trust})`);
            return target;
        }

        // 우선순위 3: 위험에 노출된 플레이어 보호 (마피아 공격 대상 예상)
        const vulnerablePlayers = analysis.alivePlayers.filter(p => 
            p.id !== doctorBot.id && 
            this.getPlayerRole(room, p.id) !== 'mafia'
        );
        
        if (vulnerablePlayers.length > 0) {
            // 경찰이나 의심도가 낮은 플레이어 우선 보호
            const priorityTargets = vulnerablePlayers.filter(p => 
                p.role === 'police' || 
                this.calculateSuspicion(p.id, this.gameHistory.get(room.code) || { rounds: [] }) < 30
            );
            
            if (priorityTargets.length > 0) {
                const target = priorityTargets[0];
                console.log(`[의사 AI] ${doctorBot.name}: 위험 노출 플레이어 ${target.name} 보호 선택`);
                return target;
            }
        }

        // 우선순위 4: 무작위 선택 (자신 제외)
        console.log(`[의사 AI] ${doctorBot.name}: 전략적 대상 없음, 무작위 선택`);
        return this.chooseRandomTarget(room, doctorBot, 'doctor');
    }

    // 경찰 봇 전략
    choosePoliceTarget(room, policeBot) {
        const analysis = this.analyzeGameState(room);
        if (!analysis) return this.chooseRandomTarget(room, policeBot, 'police');

        console.log(`[경찰 AI] ${policeBot.name}: 전략적 수사 대상 선택 시작`);

        // 우선순위 1: 의심도가 높은 플레이어
        const suspiciousPlayers = analysis.suspiciousPlayers.filter(p => 
            p.player.id !== policeBot.id && p.suspicion > 30
        );

        if (suspiciousPlayers.length > 0) {
            const target = suspiciousPlayers[0].player;
            console.log(`[경찰 AI] ${policeBot.name}: 의심스러운 플레이어 ${target.name} 수사 선택 (의심도: ${suspiciousPlayers[0].suspicion})`);
            return target;
        }

        // 우선순위 2: 아직 수사하지 않은 플레이어 중 무작위
        const history = this.gameHistory.get(room.code);
        const investigatedPlayers = new Set();
        
        if (history) {
            for (const round of history.rounds) {
                for (const investigation of round.investigations) {
                    if (investigation.investigator === policeBot.id) {
                        investigatedPlayers.add(investigation.target);
                    }
                }
            }
        }

        const uninvestigatedPlayers = analysis.alivePlayers.filter(p => 
            p.id !== policeBot.id && !investigatedPlayers.has(p.id)
        );

        if (uninvestigatedPlayers.length > 0) {
            const target = uninvestigatedPlayers[Math.floor(Math.random() * uninvestigatedPlayers.length)];
            console.log(`[경찰 AI] ${policeBot.name}: 미수사 플레이어 ${target.name} 수사 선택`);
            return target;
        }

        // 우선순위 3: 무작위 선택
        console.log(`[경찰 AI] ${policeBot.name}: 전략적 대상 없음, 무작위 선택`);
        return this.chooseRandomTarget(room, policeBot, 'police');
    }

    // 시민 봇 투표 전략
    chooseCitizenVoteTarget(room, citizenBot) {
        const analysis = this.analyzeGameState(room);
        if (!analysis) return this.chooseRandomTarget(room, citizenBot, 'citizen');

        console.log(`[시민 AI] ${citizenBot.name}: 전략적 투표 대상 선택 시작`);

        // 우선순위 1: 의심도가 높은 플레이어
        const suspiciousPlayers = analysis.suspiciousPlayers.filter(p => 
            p.player.id !== citizenBot.id && p.suspicion > 40
        );

        if (suspiciousPlayers.length > 0) {
            const target = suspiciousPlayers[0].player;
            console.log(`[시민 AI] ${citizenBot.name}: 의심스러운 플레이어 ${target.name} 투표 선택 (의심도: ${suspiciousPlayers[0].suspicion})`);
            return target;
        }

        // 우선순위 2: 무작위 선택 (자신 제외)
        console.log(`[시민 AI] ${citizenBot.name}: 전략적 대상 없음, 무작위 선택`);
        return this.chooseRandomTarget(room, citizenBot, 'citizen');
    }

    // 마피아 봇 투표 전략
    chooseMafiaVoteTarget(room, mafiaBot) {
        const analysis = this.analyzeGameState(room);
        if (!analysis) return this.chooseRandomTarget(room, mafiaBot, 'mafia');

        console.log(`[마피아 투표 AI] ${mafiaBot.name}: 전략적 투표 대상 선택 시작`);

        // 우선순위 1: 마피아가 아닌 플레이어 중 의심도가 낮은 플레이어 (시민 진영 보호)
        const nonMafiaPlayers = analysis.alivePlayers.filter(p => 
            p.id !== mafiaBot.id && 
            this.getPlayerRole(room, p.id) !== 'mafia'
        );

        if (nonMafiaPlayers.length > 0) {
            // 의심도가 낮은 순서로 정렬하여 무고한 시민을 투표 대상으로 만들기
            const suspicions = nonMafiaPlayers.map(p => ({
                player: p,
                suspicion: this.calculateSuspicion(p.id, this.gameHistory.get(room.code) || { rounds: [] })
            })).sort((a, b) => a.suspicion - b.suspicion);

            const target = suspicions[0].player;
            console.log(`[마피아 투표 AI] ${mafiaBot.name}: 무고한 시민 ${target.name} 투표 선택 (의심도: ${suspicions[0].suspicion})`);
            return target;
        }

        // 우선순위 2: 무작위 선택 (마피아 제외)
        console.log(`[마피아 투표 AI] ${mafiaBot.name}: 전략적 대상 없음, 무작위 선택`);
        return this.chooseRandomTarget(room, mafiaBot, 'mafia');
    }

    // 마법사 봇 전략
    chooseWizardTarget(room, wizardBot) {
        const analysis = this.analyzeGameState(room);
        if (!analysis) return this.chooseRandomTarget(room, wizardBot, 'wizard');

        console.log(`[마법사 AI] ${wizardBot.name}: 전략적 대상 선택 시작`);

        // 우선순위 1: 마피아 감지 - 마피아로 전환하여 승리 가능성 높이기
        const suspiciousMafia = analysis.alivePlayers.filter(p => 
            p.id !== wizardBot.id && 
            this.getPlayerRole(room, p.id) === 'mafia'
        );

        if (suspiciousMafia.length > 0) {
            const target = suspiciousMafia[0];
            console.log(`[마법사 AI] ${wizardBot.name}: 마피아 ${target.name}과 직업 교환 선택`);
            return target;
        }

        // 우선순위 2: 경찰 - 경찰이 되어 수사 정보 확보
        const policeTargets = analysis.alivePlayers.filter(p => 
            p.id !== wizardBot.id && 
            this.getPlayerRole(room, p.id) === 'police'
        );

        if (policeTargets.length > 0) {
            const target = policeTargets[0];
            console.log(`[마법사 AI] ${wizardBot.name}: 경찰 ${target.name}과 직업 교환 선택`);
            return target;
        }

        // 우선순위 3: 의사 - 치료 능력 확보
        const doctorTargets = analysis.alivePlayers.filter(p => 
            p.id !== wizardBot.id && 
            this.getPlayerRole(room, p.id) === 'doctor'
        );

        if (doctorTargets.length > 0) {
            const target = doctorTargets[0];
            console.log(`[마법사 AI] ${wizardBot.name}: 의사 ${target.name}과 직업 교환 선택`);
            return target;
        }

        // 우선순위 4: 능력 사용 안 함 (시민으로 남기)
        console.log(`[마법사 AI] ${wizardBot.name}: 능력 사용하지 않음`);
        return null;
    }

    // 무작위 대상 선택 (기본 전략)
    chooseRandomTarget(room, bot, role) {
        const alivePlayers = this.getAlivePlayers(room);
        let targets = [];

        if (role === 'mafia') {
            // 마피아는 자신과 다른 마피아 제외
            targets = alivePlayers.filter(p => 
                p.id !== bot.id && 
                this.getPlayerRole(room, p.id) !== 'mafia'
            );
        } else if (role === 'doctor') {
            // 의사는 자신을 제외한 모든 살아있는 플레이어 대상 (자신 치료 불가)
            targets = alivePlayers.filter(p => p.id !== bot.id);
        } else if (role === 'wizard') {
            // 마법사는 자신 제외한 모든 살아있는 플레이어 대상
            targets = alivePlayers.filter(p => p.id !== bot.id);
        } else {
            // 경찰과 시민은 자신 제외
            targets = alivePlayers.filter(p => p.id !== bot.id);
        }

        if (targets.length === 0) return null;
        
        return targets[Math.floor(Math.random() * targets.length)];
    }

    // 플레이어 역할 확인 (게임 로직에서 사용)
    getPlayerRole(room, playerId) {
        const player = room.players.get(playerId) || room.bots.get(playerId);
        return player ? player.role : null;
    }
}

// 게임 상태 관리
class MafiaGame {
    constructor() {
        this.rooms = new Map();
        this.players = new Map(); // socketId -> player info
        this.sessions = new Map(); // sessionId -> socketId (현재 연결된 세션)
        this.botAI = new BotAI(); // 봇 AI 시스템
    }

    createRoom(roomCode, hostSocketId, hostName, sessionId) {
        // 테스트용 이름이 아닌 경우에만 세션 중복 체크
        if (hostName !== '테스트123' && this.sessions.has(sessionId)) {
            return null;
        }

        const room = {
            code: roomCode,
            host: hostSocketId,
            players: new Map(), // socketId -> player
            bots: new Map(), // botId -> bot
            maxPlayers: 5,
            gameStarted: false,
            gameState: 'lobby', // lobby, night, morning, discussion, voting, gameOver
            phase: 'lobby',
            timer: null,
            timeLeft: 0,
            votes: new Map(),
            nightActions: new Map(),
            deadPlayers: new Set(),
            gameResults: null,
            round: 0,
            votePublic: false // 투표 공개 여부 (false: 비공개)
        };

        const player = {
            id: hostSocketId,
            name: hostName,
            sessionId,
            role: null,
            alive: true,
            isHost: true,
            isBot: false
        };

        room.players.set(hostSocketId, player);
        this.rooms.set(roomCode, room);
        this.players.set(hostSocketId, { roomCode, playerId: hostSocketId, sessionId });
        this.sessions.set(sessionId, hostSocketId);

        return room;
    }

    joinRoom(roomCode, socketId, playerName, sessionId) {
        // 테스트용 이름이 아닌 경우에만 세션 중복 확인 (어느 방이든 이미 참여 중이면 거부)
        if (playerName !== '테스트123' && this.sessions.has(sessionId)) {
            return null;
        }

        const room = this.rooms.get(roomCode);
        if (!room || room.gameStarted) {
            return null;
        }

        if (room.players.size >= room.maxPlayers) {
            return null;
        }

        // 이름 중복 체크 (플레이어와 봇 모두 확인) - 테스트용 이름은 중복 허용
        if (playerName !== '테스트123') {
            const existingNames = new Set();
            for (const player of room.players.values()) {
                existingNames.add(player.name.toLowerCase());
            }
            for (const bot of room.bots.values()) {
                existingNames.add(bot.name.toLowerCase());
            }
            
            if (existingNames.has(playerName.toLowerCase())) {
                return { error: 'name_duplicate' };
            }
        }

        const player = {
            id: socketId,
            name: playerName,
            sessionId,
            role: null,
            alive: true,
            isHost: false,
            isBot: false
        };

        room.players.set(socketId, player);
        this.players.set(socketId, { roomCode, playerId: socketId, sessionId });
        this.sessions.set(sessionId, socketId);

        return room;
    }

    addBot(roomCode, botName) {
        const room = this.rooms.get(roomCode);
        if (!room || room.gameStarted) {
            return null;
        }

        if (room.players.size + room.bots.size >= room.maxPlayers) {
            return null;
        }

        // 이름 중복 체크 (플레이어와 봇 모두 확인) - 테스트용 이름은 중복 허용
        if (botName !== '테스트123') {
            const existingNames = new Set();
            for (const player of room.players.values()) {
                existingNames.add(player.name.toLowerCase());
            }
            for (const bot of room.bots.values()) {
                existingNames.add(bot.name.toLowerCase());
            }
            
            if (existingNames.has(botName.toLowerCase())) {
                return { error: 'name_duplicate' };
            }
        }

        const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const bot = {
            id: botId,
            name: botName,
            role: null,
            alive: true,
            isHost: false,
            isBot: true
        };

        room.bots.set(botId, bot);
        return bot;
    }

    removePlayer(socketId) {
        const playerInfo = this.players.get(socketId);
        if (!playerInfo) return null;

        // 세션 맵 정리
        if (playerInfo.sessionId) {
            this.sessions.delete(playerInfo.sessionId);
        }

        const room = this.rooms.get(playerInfo.roomCode);
        if (!room) return null;

        room.players.delete(socketId);
        this.players.delete(socketId);

        // 호스트가 나갔다면 다른 플레이어를 호스트로 변경
        if (room.players.size > 0) {
            const newHost = Array.from(room.players.values())[0];
            newHost.isHost = true;
            room.host = newHost.id;
        } else {
            // 모든 플레이어가 나갔다면 방 삭제
            if (room.timer) {
                clearInterval(room.timer);
                room.timer = null;
            }
            this.rooms.delete(playerInfo.roomCode);
        }

        return room;
    }

    setMaxPlayers(roomCode, maxPlayers) {
        const room = this.rooms.get(roomCode);
        if (!room || room.gameStarted) {
            return false;
        }
        room.maxPlayers = maxPlayers;
        return true;
    }

    startGame(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room || room.gameStarted) {
            return null;
        }

        const totalPlayers = room.players.size + room.bots.size;
        if (totalPlayers < 5) {
            return null;
        }

        // 역할 배정
        this.assignRoles(room);
        room.gameStarted = true;
        room.gameState = 'night';
        room.round = 1;

        // 봇 AI 히스토리 초기화
        this.botAI.initializeRoomHistory(roomCode);

        return room;
    }

    assignRoles(room) {
        const allPlayers = [...room.players.values(), ...room.bots.values()];
        const totalPlayers = allPlayers.length;
        
        console.log(`=== 역할 배정 시작 (총 ${totalPlayers}명) ===`);
        
        // 역할 배정 (마피아 수는 총 플레이어의 1/3 정도)
        const mafiaCount = Math.floor(totalPlayers / 3);
        const roles = [];
        
        // 마피아 추가
        for (let i = 0; i < mafiaCount; i++) {
            roles.push('mafia');
        }
        
        // 특수 역할 추가
        roles.push('doctor');
        roles.push('police');
        
        // 마법사 추가 (7명 이상일 때만)
        if (totalPlayers >= 7) {
            roles.push('wizard');
            console.log('✨ 마법사 직업 추가됨! (7명 이상)');
        } else {
            console.log(`❌ 마법사 직업 추가 안됨 (${totalPlayers}명 < 7명)`);
        }
        
        // 나머지는 시민
        while (roles.length < totalPlayers) {
            roles.push('citizen');
        }
        
        console.log('배정될 역할들:', roles);
        
        // 역할 섞기
        for (let i = roles.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [roles[i], roles[j]] = [roles[j], roles[i]];
        }
        
        console.log('섞인 후 역할들:', roles);
        
        // 역할 배정
        allPlayers.forEach((player, index) => {
            player.role = roles[index];
        });
        
        // 최종 역할 배정 결과 출력
        console.log('=== 최종 역할 배정 결과 ===');
        allPlayers.forEach(player => {
            console.log(`${player.name}: ${player.role}`);
        });
        console.log('===========================');
    }

    processNightPhase(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        console.log(`=== 밤 ${room.round} 결과 처리 ===`);
        console.log('nightActions 크기:', room.nightActions.size);
        console.log('모든 nightActions:', Array.from(room.nightActions.entries()).map(([playerId, action]) => {
            const player = room.players.get(playerId) || room.bots.get(playerId);
            return {
                player: player?.name || playerId,
                role: player?.role,
                action: action.type,
                target: action.target
            };
        }));

        const results = {
            killed: null,
            saved: null,
            investigated: null,
            roleSwapped: null
        };

        // 마법사의 능력 처리 (다른 행동보다 먼저 처리)
        for (const [playerId, action] of room.nightActions) {
            if (action.type === 'swap') {
                const wizard = room.players.get(playerId) || room.bots.get(playerId);
                const target = room.players.get(action.target) || room.bots.get(action.target);
                
                if (wizard && target) {
                    const wizardRole = wizard.role;
                    const targetRole = target.role;
                    
                    // 직업 교환
                    wizard.role = targetRole;
                    target.role = 'citizen';
                    
                    results.roleSwapped = {
                        wizard: playerId,
                        target: action.target,
                        wizardNewRole: targetRole,
                        targetNewRole: 'citizen'
                    };
                    
                    console.log(`마법사 ${wizard.name}이 ${target.name}과 직업을 교환했습니다. 마법사: ${wizardRole} → ${targetRole}, 타겟: ${targetRole} → citizen`);
                }
                break;
            }
        }

        // 마피아의 공격 처리 (마지막 선택 우선)
        let targetToKill = null;
        let latestKillTime = 0;
        for (const [, action] of room.nightActions) {
            if (action.type === 'kill') {
                // time 속성이 있다면 최신 시간 기준으로, 없으면 마지막 반복 기준으로 처리
                if (action.time !== undefined) {
                    if (action.time > latestKillTime) {
                        latestKillTime = action.time;
                        targetToKill = action.target;
                    }
                } else {
                    // 하위 호환: time이 없으면 단순히 마지막 kill 액션으로 간주
                    targetToKill = action.target;
                }
            }
        }

        if (targetToKill) {
            // 의사의 치료 확인
            let saved = false;
            for (const [playerId, action] of room.nightActions) {
                if (action.type === 'save' && action.target === targetToKill) {
                    saved = true;
                    results.saved = targetToKill;
                    break;
                }
            }

            if (!saved) {
                results.killed = targetToKill;
                this.killPlayer(room, targetToKill);
            }
        }

        // 경찰의 수사 처리
        for (const [playerId, action] of room.nightActions) {
            if (action.type === 'investigate') {
                results.investigated = {
                    investigator: playerId,
                    target: action.target,
                    result: this.getPlayerRole(room, action.target) === 'mafia' ? 'mafia' : 'not_mafia'
                };
                break;
            }
        }

        // 봇 AI 히스토리 업데이트 (밤 결과)
        const nightData = {
            nightDeaths: results.killed ? [results.killed] : [],
            investigations: results.investigated ? [results.investigated] : [],
            roleSwaps: results.roleSwapped ? [results.roleSwapped] : []
        };
        
        // 현재 라운드 히스토리에 밤 결과 추가
        const history = this.botAI.gameHistory.get(room.code);
        if (history) {
            history.currentRound.nightActions = Object.fromEntries(room.nightActions);
            history.currentRound.deaths = nightData.nightDeaths;
            history.currentRound.investigations = nightData.investigations;
            history.currentRound.roleSwaps = nightData.roleSwaps;
        }
        
        console.log(`[AI 히스토리] 라운드 ${room.round} 밤 결과 업데이트:`, nightData);

        room.nightActions.clear();
        console.log('밤 결과:', results);
        console.log('nightActions 처리 완료 후 초기화됨');
        return results;
    }

    processBotNightActions(room) {
        const bots = Array.from(room.bots.values()).filter(bot => bot.alive);
        
        console.log(`봇들의 밤 행동 처리 시작 (라운드 ${room.round}):`, bots.map(b => ({ name: b.name, role: b.role })));
        
        // 게임 히스토리 초기화
        this.botAI.initializeRoomHistory(room.code);
        
        for (const bot of bots) {
            let target = null;
            
            if (bot.role === 'mafia') {
                // 마피아 봇: AI 전략 사용
                target = this.botAI.chooseMafiaTarget(room, bot);
                if (target) {
                    room.nightActions.set(bot.id, { type: 'kill', target: target.id, time: Date.now() });
                    console.log(`마피아 봇 ${bot.name}이 ${target.name}을 공격 선택`);
                } else {
                    console.log(`마피아 봇 ${bot.name}: 공격할 대상이 없음`);
                }
            } else if (bot.role === 'doctor') {
                // 의사 봇: AI 전략 사용
                target = this.botAI.chooseDoctorTarget(room, bot);
                if (target) {
                    room.nightActions.set(bot.id, { type: 'save', target: target.id, time: Date.now() });
                    console.log(`의사 봇 ${bot.name}이 ${target.name}을 치료 선택`);
                } else {
                    console.log(`의사 봇 ${bot.name}: 치료할 대상이 없음`);
                }
            } else if (bot.role === 'police') {
                // 경찰 봇: AI 전략 사용
                target = this.botAI.choosePoliceTarget(room, bot);
                if (target) {
                    room.nightActions.set(bot.id, { type: 'investigate', target: target.id, time: Date.now() });
                    console.log(`경찰 봇 ${bot.name}이 ${target.name}을 수사 선택`);
                } else {
                    console.log(`경찰 봇 ${bot.name}: 수사할 대상이 없음`);
                }
            } else if (bot.role === 'wizard') {
                // 마법사 봇: AI 전략 사용
                target = this.botAI.chooseWizardTarget(room, bot);
                if (target) {
                    room.nightActions.set(bot.id, { type: 'swap', target: target.id, time: Date.now() });
                    console.log(`마법사 봇 ${bot.name}이 ${target.name}과 직업 교환 선택`);
                } else {
                    console.log(`마법사 봇 ${bot.name}: 교환할 대상이 없음`);
                }
            }
        }
    }

    processBotVotes(room) {
        const bots = Array.from(room.bots.values()).filter(bot => bot.alive);
        
        console.log(`봇들의 투표 처리 시작 (라운드 ${room.round}):`, bots.map(b => ({ name: b.name, role: b.role })));
        
        // 게임 히스토리 초기화
        this.botAI.initializeRoomHistory(room.code);
        
        for (const bot of bots) {
            let target = null;
            
            if (bot.role === 'mafia') {
                // 마피아 봇: 마피아 투표 전략 사용
                target = this.botAI.chooseMafiaVoteTarget(room, bot);
            } else if (bot.role === 'citizen') {
                // 시민 봇: 시민 투표 전략 사용
                target = this.botAI.chooseCitizenVoteTarget(room, bot);
            } else if (bot.role === 'doctor' || bot.role === 'police' || bot.role === 'wizard') {
                // 의사/경찰/마법사 봇: 시민 전략 사용 (특수 시민)
                target = this.botAI.chooseCitizenVoteTarget(room, bot);
            }
            
            if (target) {
                room.votes.set(bot.id, target.id);
                console.log(`${bot.role} 봇 ${bot.name}이 ${target.name}에게 투표`);
            } else {
                console.log(`봇 ${bot.name}: 투표할 대상이 없음`);
            }
        }
    }

    getAlivePlayers(room) {
        const alivePlayers = [];
        
        for (const player of room.players.values()) {
            if (player.alive) alivePlayers.push(player);
        }
        
        for (const bot of room.bots.values()) {
            if (bot.alive) alivePlayers.push(bot);
        }
        
        return alivePlayers;
    }

    getPlayerRole(room, playerId) {
        const player = room.players.get(playerId) || room.bots.get(playerId);
        return player ? player.role : null;
    }

    killPlayer(room, playerId) {
        const player = room.players.get(playerId) || room.bots.get(playerId);
        if (player) {
            player.alive = false;
            room.deadPlayers.add(playerId);

            // 사망한 플레이어를 전용 채팅방에 포함시킵니다.
            // 실제 소켓이 존재하는 플레이어(봇 제외)에 대해서만 처리합니다.
            const deadRoom = `${room.code}_dead`;
            const playerSocket = io.sockets.sockets.get(playerId);
            if (playerSocket) {
                playerSocket.join(deadRoom);
            }
        }
    }

    checkGameEnd(room) {
        const alivePlayers = this.getAlivePlayers(room);
        const aliveMafia = alivePlayers.filter(p => p.role === 'mafia');
        const aliveCitizens = alivePlayers.filter(p => p.role !== 'mafia');

        if (aliveMafia.length === 0) {
            return { ended: true, winner: 'citizens' };
        }

        if (aliveMafia.length >= aliveCitizens.length) {
            return { ended: true, winner: 'mafia' };
        }

        return { ended: false };
    }

    processVoting(room) {
        const voteCounts = new Map();
        
        for (const [voter, target] of room.votes) {
            const count = voteCounts.get(target) || 0;
            voteCounts.set(target, count + 1);
        }

        // 최고 득표수 및 동점 여부 확인
        let maxVotes = 0;
        let topCandidates = [];

        for (const [target, votes] of voteCounts) {
            if (votes > maxVotes) {
                maxVotes = votes;
                topCandidates = [target];
            } else if (votes === maxVotes) {
                topCandidates.push(target);
            }
        }

        let eliminated = null;
        // 동점 없이 단일 후보가 있을 때만 처형
        if (topCandidates.length === 1 && maxVotes > 0) {
            eliminated = topCandidates[0];
            this.killPlayer(room, eliminated);
        }

        // 봇 AI 히스토리 업데이트
        const eliminatedPlayer = eliminated ? (room.players.get(eliminated) || room.bots.get(eliminated)) : null;
        const roundData = {
            votes: Object.fromEntries(room.votes),
            eliminated: eliminatedPlayer ? { id: eliminated, role: eliminatedPlayer.role } : null,
            voteCounts: Object.fromEntries(voteCounts)
        };
        
        this.botAI.updateRoundHistory(room, roundData);
        console.log(`[AI 히스토리] 라운드 ${room.round} 투표 결과 업데이트:`, roundData);

        room.votes.clear();
        return eliminated;
    }

    resetGame(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        // 정리할 타이머가 있으면 중지
        if (room.timer) {
            clearInterval(room.timer);
            room.timer = null;
        }

        room.gameStarted = false;
        room.gameState = 'lobby';
        room.phase = 'lobby';
        room.timeLeft = 0;
        room.round = 0;
        room.votes.clear();
        room.nightActions.clear();
        room.deadPlayers.clear();
        room.gameResults = null;

        // 플레이어/봇 상태 초기화
        for (const player of room.players.values()) {
            player.alive = true;
            player.role = null;
        }
        for (const bot of room.bots.values()) {
            bot.alive = true;
            bot.role = null;
        }

        // 봇 AI 히스토리 초기화
        this.botAI.resetGameHistory(roomCode);
        console.log(`[AI 히스토리] 게임 리셋: ${roomCode} 히스토리 초기화`);

        return room;
    }

    // 공개방 목록 반환
    getRoomList() {
        const publicRooms = [];
        for (const [roomCode, room] of this.rooms) {
            // 게임이 시작되지 않은 방만 표시
            if (!room.gameStarted) {
                const totalPlayers = room.players.size + room.bots.size;
                const hostPlayer = room.players.get(room.host);
                
                publicRooms.push({
                    roomCode: roomCode,
                    hostName: hostPlayer ? hostPlayer.name : '호스트',
                    currentPlayers: totalPlayers,
                    maxPlayers: room.maxPlayers,
                    canJoin: totalPlayers < room.maxPlayers
                });
            }
        }
        return publicRooms;
    }
}

const game = new MafiaGame();

// Socket.IO 연결 처리
io.on('connection', (socket) => {
    console.log('새 플레이어 연결:', socket.id);

    // 방 목록 요청
    socket.on('getRoomList', () => {
        const roomList = game.getRoomList();
        socket.emit('roomList', roomList);
    });

    // 방 생성
    socket.on('createRoom', (data) => {
        const { playerName, sessionId } = data;
        const roomCode = Math.random().toString(36).substr(2, 6).toUpperCase();
        
        const room = game.createRoom(roomCode, socket.id, playerName, sessionId);
        if (!room) {
            socket.emit('joinError', { message: '동일 브라우저 세션에서 이미 게임에 참여 중입니다.' });
            return;
        }

        socket.join(roomCode);
        
        socket.emit('roomCreated', {
            roomCode: roomCode,
            success: true
        });
        
        io.to(roomCode).emit('playerListUpdate', {
            players: Array.from(room.players.values()),
            bots: Array.from(room.bots.values()),
            maxPlayers: room.maxPlayers
        });
        
        // 모든 클라이언트에게 방 목록 업데이트 알림
        io.emit('roomListUpdate');
    });

    // 방 참가
    socket.on('joinRoom', (data) => {
        const { roomCode, playerName, sessionId } = data;
        const result = game.joinRoom(roomCode, socket.id, playerName, sessionId);
        
        if (result && !result.error) {
            socket.join(roomCode);
            socket.emit('roomJoined', {
                roomCode: roomCode,
                success: true
            });
            
            io.to(roomCode).emit('playerListUpdate', {
                players: Array.from(result.players.values()),
                bots: Array.from(result.bots.values()),
                maxPlayers: result.maxPlayers
            });
            
            io.to(roomCode).emit('chatMessage', {
                type: 'system',
                message: `${playerName}님이 게임에 참가했습니다.`
            });
            
            // 모든 클라이언트에게 방 목록 업데이트 알림
            io.emit('roomListUpdate');
        } else if (result && result.error === 'name_duplicate') {
            socket.emit('joinError', {
                message: '같은 이름의 플레이어가 이미 방에 있습니다. 다른 이름을 사용해주세요.'
            });
        } else {
            socket.emit('joinError', {
                message: '방을 찾을 수 없거나 게임이 이미 시작되었거나, 동일 브라우저 세션에서 이미 참여 중입니다.'
            });
        }
    });

    // 봇 추가
    socket.on('addBot', (data) => {
        const playerInfo = game.players.get(socket.id);
        if (!playerInfo) return;
        
        const room = game.rooms.get(playerInfo.roomCode);
        if (!room || !room.players.get(socket.id)?.isHost) return;
        
        const { botName } = data;
        const result = game.addBot(playerInfo.roomCode, botName);
        
        if (result && !result.error) {
            io.to(playerInfo.roomCode).emit('playerListUpdate', {
                players: Array.from(room.players.values()),
                bots: Array.from(room.bots.values()),
                maxPlayers: room.maxPlayers
            });
            
            io.to(playerInfo.roomCode).emit('chatMessage', {
                type: 'system',
                message: `봇 ${botName}이 추가되었습니다.`
            });
            
            // 모든 클라이언트에게 방 목록 업데이트 알림
            io.emit('roomListUpdate');
        } else if (result && result.error === 'name_duplicate') {
            socket.emit('botAddError', {
                message: '같은 이름의 플레이어 또는 봇이 이미 방에 있습니다. 다른 이름을 사용해주세요.'
            });
        }
    });

    // 최대 플레이어 수 설정
    socket.on('setMaxPlayers', (data) => {
        const playerInfo = game.players.get(socket.id);
        if (!playerInfo) return;
        
        const room = game.rooms.get(playerInfo.roomCode);
        if (!room || !room.players.get(socket.id)?.isHost) return;
        
        const { maxPlayers } = data;
        if (game.setMaxPlayers(playerInfo.roomCode, maxPlayers)) {
            io.to(playerInfo.roomCode).emit('playerListUpdate', {
                players: Array.from(room.players.values()),
                bots: Array.from(room.bots.values()),
                maxPlayers: room.maxPlayers
            });
            
            // 모든 클라이언트에게 방 목록 업데이트 알림
            io.emit('roomListUpdate');
        }
    });

    // 게임 시작
    socket.on('startGame', () => {
        const playerInfo = game.players.get(socket.id);
        if (!playerInfo) return;
        
        const room = game.rooms.get(playerInfo.roomCode);
        if (!room || !room.players.get(socket.id)?.isHost) return;
        
        const startedRoom = game.startGame(playerInfo.roomCode);
        
        if (startedRoom) {
            // 각 플레이어에게 역할 정보 전송
            for (const player of startedRoom.players.values()) {
                // 마피아인 경우 다른 마피아들의 정보도 함께 전송
                let mafiaTeam = null;
                if (player.role === 'mafia') {
                    mafiaTeam = [];
                    // 모든 마피아 플레이어와 봇 찾기
                    for (const p of startedRoom.players.values()) {
                        if (p.role === 'mafia') {
                            mafiaTeam.push({ id: p.id, name: p.name, isBot: false });
                        }
                    }
                    for (const bot of startedRoom.bots.values()) {
                        if (bot.role === 'mafia') {
                            mafiaTeam.push({ id: bot.id, name: bot.name, isBot: true });
                        }
                    }
                }
                
                io.to(player.id).emit('roleAssigned', {
                    role: player.role,
                    gameStarted: true,
                    mafiaTeam: mafiaTeam
                });
            }
            
            io.to(playerInfo.roomCode).emit('gameStarted', {
                gameState: 'night',
                round: startedRoom.round
            });
            
            // 밤 페이즈 시작
            startNightPhase(playerInfo.roomCode, startedRoom);
            
            // 모든 클라이언트에게 방 목록 업데이트 알림 (게임 시작으로 방이 목록에서 제거됨)
            io.emit('roomListUpdate');
        } else {
            socket.emit('gameStartError', {
                message: '게임을 시작하려면 최소 5명의 플레이어가 필요합니다.'
            });
        }
    });

    // 밤 행동 (마피아 공격, 의사 치료, 경찰 수사)
    socket.on('nightAction', (data) => {
        const playerInfo = game.players.get(socket.id);
        if (!playerInfo) {
            console.log('nightAction 실패: playerInfo 없음', socket.id);
            return;
        }
        
        const room = game.rooms.get(playerInfo.roomCode);
        if (!room) {
            console.log('nightAction 실패: room 없음', playerInfo.roomCode);
            return;
        }
        
        if (room.gameState !== 'night') {
            console.log('nightAction 실패: 밤이 아님', room.gameState);
            return;
        }
        
        const player = room.players.get(socket.id);
        if (!player) {
            console.log('nightAction 실패: player 없음', socket.id);
            return;
        }
        
        if (!player.alive) {
            console.log('nightAction 실패: 죽은 플레이어', player.name);
            return;
        }
        
        const { action, target } = data;
        console.log('밤 행동 수신:', {
            player: player.name,
            role: player.role,
            action,
            target,
            round: room.round,
            nightActionsSize: room.nightActions.size
        });
        
        room.nightActions.set(socket.id, { type: action, target, time: Date.now() });
        
        socket.emit('actionConfirmed', { action, target });
        
        // 마피아가 공격 대상을 선택했을 때 마피아 팀에게 알림
        if (action === 'kill' && player.role === 'mafia') {
            const targetPlayer = room.players.get(target) || room.bots.get(target);
            if (targetPlayer) {
                // 마피아 팀원들에게만 알림 전송
                const allPlayers = [...room.players.values(), ...room.bots.values()];
                const mafiaMembers = allPlayers.filter(p => p.role === 'mafia' && p.alive);
                
                for (const mafia of mafiaMembers) {
                    if (mafia.id !== socket.id && !mafia.isBot) { // 봇 제외, 행동한 마피아 본인 제외
                        io.to(mafia.id).emit('mafiaTeamAction', {
                            message: `${targetPlayer.name}을 죽이기로 했습니다.`,
                            actor: player.name,
                            target: targetPlayer.name
                        });
                    }
                }
            }
        }
    });

    // 투표
    socket.on('vote', (data) => {
        const playerInfo = game.players.get(socket.id);
        if (!playerInfo) return;
        
        const room = game.rooms.get(playerInfo.roomCode);
        if (!room || room.gameState !== 'voting') return;
        
        const player = room.players.get(socket.id);
        if (!player) return;
        
        // 죽은 플레이어는 투표할 수 없음
        if (!player.alive) {
            socket.emit('voteError', {
                message: '죽은 사람은 투표할 수 없습니다.'
            });
            return;
        }
        
        const { target } = data;
        room.votes.set(socket.id, target);
        
        socket.emit('voteConfirmed', { target });
        
        // 모든 살아있는 플레이어가 투표했는지 확인 (단, 최소 5초는 기다리기)
        const alivePlayers = game.getAlivePlayers(room);
        if (room.votes.size >= alivePlayers.length && room.timeLeft <= 5) {
            if (room.timer) {
                clearInterval(room.timer);
                room.timer = null;
            }
            processVotingPhase(playerInfo.roomCode, room);
        }
    });

    // 채팅 메시지
    socket.on('chatMessage', (data) => {
        const playerInfo = game.players.get(socket.id);
        if (!playerInfo) return;
        
        const room = game.rooms.get(playerInfo.roomCode);
        if (!room) return;
        
        const player = room.players.get(socket.id);
        if (!player) return;
        
        const { message } = data;
        const timestamp = new Date();

        // 채팅 메시지를 AI 히스토리에 저장
        const messageType = player.alive ? 'player' : 'dead';
        game.botAI.addChatMessage(playerInfo.roomCode, {
            type: messageType,
            playerId: socket.id,
            playerName: player.name,
            message,
            round: room.round,
            gamePhase: room.gameState
        }, room);

        if (player.alive) {
            // 살아있는 플레이어의 메시지는 방 전체에 전송
            io.to(playerInfo.roomCode).emit('chatMessage', {
                type: 'player',
                playerName: player.name,
                message,
                timestamp
            });
        } else {
            // 죽은 플레이어의 메시지는 죽은 사람들끼리만 전송
            const deadRoom = `${playerInfo.roomCode}_dead`;
            io.to(deadRoom).emit('chatMessage', {
                type: 'dead',
                playerName: player.name,
                message,
                timestamp
            });
        }
    });

    // 게임 초기화
    socket.on('resetGame', () => {
        const playerInfo = game.players.get(socket.id);
        if (!playerInfo) return;

        const room = game.rooms.get(playerInfo.roomCode);
        if (!room) return;

        // 호스트만 새 게임을 초기화할 수 있음
        if (!room.players.get(socket.id)?.isHost) return;

        const resetRoom = game.resetGame(playerInfo.roomCode);
        if (!resetRoom) return;

        io.to(playerInfo.roomCode).emit('gameReset', {
            players: Array.from(resetRoom.players.values()),
            bots: Array.from(resetRoom.bots.values()),
            maxPlayers: resetRoom.maxPlayers
        });

        // 모든 클라이언트에게 방 목록 업데이트 알림 (새 게임으로 방이 다시 목록에 표시됨)
        io.emit('roomListUpdate');
    });

    // 투표 공개 설정
    socket.on('setVoteVisibility', (data) => {
        const playerInfo = game.players.get(socket.id);
        if (!playerInfo) return;

        const room = game.rooms.get(playerInfo.roomCode);
        if (!room || !room.players.get(socket.id)?.isHost) return;

        const { votePublic } = data;
        room.votePublic = !!votePublic;

        io.to(playerInfo.roomCode).emit('voteVisibilityUpdated', {
            votePublic: room.votePublic
        });
    });

    // 연결 해제
    socket.on('disconnect', () => {
        console.log('플레이어 연결 해제:', socket.id);
        
        const room = game.removePlayer(socket.id);
        if (room) {
            io.to(room.code).emit('playerListUpdate', {
                players: Array.from(room.players.values()),
                bots: Array.from(room.bots.values()),
                maxPlayers: room.maxPlayers
            });
            
            // 모든 클라이언트에게 방 목록 업데이트 알림
            io.emit('roomListUpdate');
        }
    });
});

// 게임 단계 처리 함수들
function startNightPhase(roomCode, room) {
    console.log(`=== 밤 ${room.round} 시작 ===`);
    
    // 기존 타이머 정리
    if (room.timer) {
        clearInterval(room.timer);
        room.timer = null;
    }
    
    // 밤 행동 초기화 (매 라운드마다 깨끗하게 시작)
    room.nightActions.clear();
    console.log('nightActions 초기화됨');
    
    room.gameState = 'night';
    room.timeLeft = 15; // 15초 (추가 5초 감소)
    
    // 살아있는 플레이어들의 역할 확인
    const alivePlayers = game.getAlivePlayers(room);
    console.log('살아있는 플레이어들:', alivePlayers.map(p => ({ name: p.name, role: p.role, alive: p.alive })));
    
    io.to(roomCode).emit('phaseChange', {
        phase: 'night',
        timeLeft: room.timeLeft,
        round: room.round
    });
    
    // 봇들의 밤 행동을 지연시켜서 처리 (5-20초 사이에 랜덤하게)
    setTimeout(() => {
        if (room.gameState === 'night') {
            game.processBotNightActions(room);
        }
    }, Math.random() * 15000 + 5000); // 5-20초 지연
    
    // 타이머 시작
    room.timer = setInterval(() => {
        room.timeLeft--;
        
        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            room.timer = null;
            endNightPhase(roomCode, room);
        } else {
            io.to(roomCode).emit('timerUpdate', { timeLeft: room.timeLeft });
        }
    }, 1000);
}

function endNightPhase(roomCode, room) {
    const results = game.processNightPhase(roomCode);
    
    room.gameState = 'morning';
    
    // 마법사 역할 교환이 있었다면 해당 플레이어들에게 새로운 역할 정보 전송
    if (results.roleSwapped) {
        const wizard = room.players.get(results.roleSwapped.wizard) || room.bots.get(results.roleSwapped.wizard);
        const target = room.players.get(results.roleSwapped.target) || room.bots.get(results.roleSwapped.target);
        
        // 마피아 팀 구성이 변경되었는지 확인
        const mafiaTeamChanged = (wizard && wizard.role === 'mafia') || (target && target.role === 'mafia');
        
        // 마법사에게 새로운 역할 정보 전송 (실제 플레이어인 경우만)
        if (wizard && room.players.has(results.roleSwapped.wizard)) {
            let mafiaTeam = null;
            if (wizard.role === 'mafia') {
                mafiaTeam = [];
                // 모든 마피아 플레이어와 봇 찾기
                for (const p of room.players.values()) {
                    if (p.role === 'mafia') {
                        mafiaTeam.push({ id: p.id, name: p.name, isBot: false });
                    }
                }
                for (const bot of room.bots.values()) {
                    if (bot.role === 'mafia') {
                        mafiaTeam.push({ id: bot.id, name: bot.name, isBot: true });
                    }
                }
            }
            
            io.to(results.roleSwapped.wizard).emit('roleAssigned', {
                role: wizard.role,
                gameStarted: true,
                mafiaTeam: mafiaTeam
            });
            console.log(`마법사 ${wizard.name}에게 새로운 역할 ${wizard.role} 정보 전송`);
        }
        
        // 대상에게 새로운 역할 정보 전송 (실제 플레이어인 경우만)
        if (target && room.players.has(results.roleSwapped.target)) {
            io.to(results.roleSwapped.target).emit('roleAssigned', {
                role: target.role,
                gameStarted: true,
                mafiaTeam: null // 시민이므로 마피아팀 정보 없음
            });
            console.log(`대상 ${target.name}에게 새로운 역할 ${target.role} 정보 전송`);
        }
        
        // 마피아 팀 구성이 변경되었다면 모든 마피아들에게 새로운 팀 정보 전송
        if (mafiaTeamChanged) {
            const newMafiaTeam = [];
            // 모든 마피아 플레이어와 봇 찾기
            for (const p of room.players.values()) {
                if (p.role === 'mafia') {
                    newMafiaTeam.push({ id: p.id, name: p.name, isBot: false });
                }
            }
            for (const bot of room.bots.values()) {
                if (bot.role === 'mafia') {
                    newMafiaTeam.push({ id: bot.id, name: bot.name, isBot: true });
                }
            }
            
            // 모든 마피아 플레이어들에게 새로운 팀 정보 전송
            for (const p of room.players.values()) {
                if (p.role === 'mafia') {
                    io.to(p.id).emit('roleAssigned', {
                        role: 'mafia',
                        gameStarted: true,
                        mafiaTeam: newMafiaTeam
                    });
                }
            }
            console.log('마피아 팀 구성 변경으로 모든 마피아들에게 새로운 팀 정보 전송');
        }
    }
    
    io.to(roomCode).emit('nightResults', results);
    io.to(roomCode).emit('phaseChange', {
        phase: 'morning',
        results: results
    });
    
    // 플레이어 목록 업데이트 (죽은 플레이어 반영)
    io.to(roomCode).emit('playerListUpdate', {
        players: Array.from(room.players.values()),
        bots: Array.from(room.bots.values()),
        maxPlayers: room.maxPlayers
    });
    
    // 게임 종료 확인
    const gameEnd = game.checkGameEnd(room);
    if (gameEnd.ended) {
        endGame(roomCode, room, gameEnd.winner);
    } else {
        setTimeout(() => {
            startDiscussionPhase(roomCode, room);
        }, 5000); // 5초 후 토론 시작
    }
}

function startDiscussionPhase(roomCode, room) {
    // 기존 타이머 정리
    if (room.timer) {
        clearInterval(room.timer);
        room.timer = null;
    }
    
    room.gameState = 'discussion';
    room.timeLeft = 45; // 45초 (추가 5초 감소)
    
    io.to(roomCode).emit('phaseChange', {
        phase: 'discussion',
        timeLeft: room.timeLeft
    });
    
    room.timer = setInterval(() => {
        room.timeLeft--;
        
        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            room.timer = null;
            startVotingPhase(roomCode, room);
        } else {
            io.to(roomCode).emit('timerUpdate', { timeLeft: room.timeLeft });
        }
    }, 1000);
}

function startVotingPhase(roomCode, room) {
    // 기존 타이머 정리
    if (room.timer) {
        clearInterval(room.timer);
        room.timer = null;
    }
    
    room.gameState = 'voting';
    room.timeLeft = 15; // 15초 (추가 5초 감소)
    
    io.to(roomCode).emit('phaseChange', {
        phase: 'voting',
        timeLeft: room.timeLeft
    });
    
    // 봇들의 투표를 지연시켜서 처리 (5-15초 사이에 랜덤하게)
    setTimeout(() => {
        if (room.gameState === 'voting') {
            game.processBotVotes(room);
        }
    }, Math.random() * 10000 + 5000); // 5-15초 지연
    
    room.timer = setInterval(() => {
        room.timeLeft--;
        
        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            room.timer = null;
            processVotingPhase(roomCode, room);
        } else {
            io.to(roomCode).emit('timerUpdate', { timeLeft: room.timeLeft });
        }
    }, 1000);
}

function processVotingPhase(roomCode, room) {
    // 각 후보별 득표 수 집계
    const voteCountsMap = new Map();
    for (const target of room.votes.values()) {
        const count = voteCountsMap.get(target) || 0;
        voteCountsMap.set(target, count + 1);
    }
    const voteCounts = Array.from(voteCountsMap.entries()); // [ [targetId, count], ... ] 형식

    const voteDetails = room.votePublic ? Array.from(room.votes.entries()) : null;

    const eliminated = game.processVoting(room);

    io.to(roomCode).emit('votingResults', {
        eliminated: eliminated,
        voteDetails: voteDetails,
        voteCounts: voteCounts,
        votePublic: room.votePublic
    });
    
    // 플레이어 목록 업데이트 (처형된 플레이어 반영)
    io.to(roomCode).emit('playerListUpdate', {
        players: Array.from(room.players.values()),
        bots: Array.from(room.bots.values()),
        maxPlayers: room.maxPlayers
    });
    
    // 게임 종료 확인
    const gameEnd = game.checkGameEnd(room);
    if (gameEnd.ended) {
        endGame(roomCode, room, gameEnd.winner);
    } else {
        room.round++;
        setTimeout(() => {
            startNightPhase(roomCode, room);
        }, 5000); // 5초 후 다음 라운드 시작
    }
}

function endGame(roomCode, room, winner) {
    // 타이머 정리
    if (room.timer) {
        clearInterval(room.timer);
        room.timer = null;
    }
    
    room.gameState = 'gameOver';
    room.gameResults = { winner };
    
    io.to(roomCode).emit('gameEnd', {
        winner: winner,
        players: Array.from(room.players.values()),
        bots: Array.from(room.bots.values())
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`마피아 게임 서버가 포트 ${PORT}에서 실행 중입니다.`);
}); 