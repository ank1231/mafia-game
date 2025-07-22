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
        this.gameHistory = new Map(); // roomCode -> game history
        this.botPersonalities = new Map(); // botId -> personality traits
        this.fakePoliceBots = new Map(); // roomCode -> fake police bot id
        this.fakeInvestigations = new Map(); // roomCode -> fake investigation history
        // 🆕 봇 메시지 다양성 시스템
        this.botMessageHistory = new Map(); // botId -> used messages array
        this.messageWeights = new Map(); // botId -> { message: weight }
        this.emotionalStates = new Map(); // botId -> emotional state
    }

    // === 봇 메시지 다양성 시스템 ===
    
    // 봇 메시지 히스토리 초기화
    initializeBotMessageHistory(botId) {
        if (!this.botMessageHistory.has(botId)) {
            this.botMessageHistory.set(botId, []);
            this.messageWeights.set(botId, new Map());
            this.emotionalStates.set(botId, {
                tension: 0.5, // 0.0 (편안) ~ 1.0 (극도긴장)
                suspicion: 0.5, // 0.0 (신뢰) ~ 1.0 (의심)
                confidence: 0.5, // 0.0 (불안) ~ 1.0 (확신)
                anger: 0.0 // 0.0 (평온) ~ 1.0 (분노)
            });
        }
    }

    // 사용된 메시지 기록
    recordUsedMessage(botId, message) {
        this.initializeBotMessageHistory(botId);
        
        const history = this.botMessageHistory.get(botId);
        const weights = this.messageWeights.get(botId);
        
        // 최근 사용된 메시지 기록 (최대 20개)
        history.push({
            message: message,
            timestamp: Date.now(),
            round: this.getCurrentRoundForBot(botId)
        });
        
        if (history.length > 20) {
            history.shift();
        }
        
        // 가중치 감소 (같은 메시지는 재사용 확률 낮춤)
        const currentWeight = weights.get(message) || 1.0;
        weights.set(message, Math.max(0.1, currentWeight * 0.6));
        
        console.log(`[메시지 기록] ${botId}: "${message}" 사용됨 (가중치: ${weights.get(message).toFixed(2)})`);
    }

    // 메시지 중복도 검사
    getMessageDiversityScore(botId, message) {
        this.initializeBotMessageHistory(botId);
        
        const history = this.botMessageHistory.get(botId);
        const weights = this.messageWeights.get(botId);
        
        // 최근 5개 메시지에서 완전 일치 검사
        const recentMessages = history.slice(-5);
        if (recentMessages.some(h => h.message === message)) {
            return 0.1; // 최근에 사용한 메시지는 매우 낮은 점수
        }
        
        // 유사도 검사 (키워드 기반)
        const messageWords = message.toLowerCase().split(/\s+/);
        let similarityPenalty = 0;
        
        for (const historyItem of history.slice(-10)) {
            const historyWords = historyItem.message.toLowerCase().split(/\s+/);
            const commonWords = messageWords.filter(word => historyWords.includes(word));
            if (commonWords.length > 0) {
                similarityPenalty += commonWords.length / messageWords.length * 0.3;
            }
        }
        
        // 가중치 기반 점수
        const weightScore = weights.get(message) || 1.0;
        
        return Math.max(0.1, weightScore - similarityPenalty);
    }

    // 감정 상태 업데이트
    updateEmotionalState(botId, gameContext) {
        this.initializeBotMessageHistory(botId);
        
        const state = this.emotionalStates.get(botId);
        const { round, alivePlayers, suspiciousPlayers, recentDeaths } = gameContext;
        
        // 라운드가 진행될수록 긴장도 증가
        state.tension = Math.min(1.0, 0.3 + (round * 0.15));
        
        // 살아있는 플레이어 수가 적을수록 긴장도 증가  
        if (alivePlayers <= 4) {
            state.tension = Math.min(1.0, state.tension + 0.3);
        }
        
        // 최근 죽음이 있으면 긴장도 증가
        if (recentDeaths > 0) {
            state.tension = Math.min(1.0, state.tension + 0.2);
        }
        
        // 의심받는 상황이면 불안감 증가
        if (suspiciousPlayers && suspiciousPlayers.some(p => p.id === botId)) {
            state.confidence = Math.max(0.1, state.confidence - 0.3);
            state.anger = Math.min(1.0, state.anger + 0.4);
        }
        
        console.log(`[감정 상태] ${botId}: 긴장${state.tension.toFixed(2)} 의심${state.suspicion.toFixed(2)} 확신${state.confidence.toFixed(2)} 분노${state.anger.toFixed(2)}`);
    }

    // 현재 라운드 가져오기 (헬퍼)
    getCurrentRoundForBot(botId) {
        // 봇이 속한 방 찾기 (추후 개선 필요)
        for (const [roomCode, history] of this.gameHistory) {
            return history.rounds.length + 1; // 현재 진행중인 라운드
        }
        return 1;
    }

    // 가중치 기반 메시지 선택
    selectDiverseMessage(botId, messageOptions) {
        if (!messageOptions || messageOptions.length === 0) return null;
        
        // 각 메시지의 다양성 점수 계산
        const scoredMessages = messageOptions.map(message => ({
            message,
            score: this.getMessageDiversityScore(botId, message)
        }));
        
        // 점수 기반 가중치 선택
        const totalScore = scoredMessages.reduce((sum, item) => sum + item.score, 0);
        if (totalScore === 0) {
            // 모든 메시지가 최근에 사용됨 - 랜덤 선택
            return messageOptions[Math.floor(Math.random() * messageOptions.length)];
        }
        
        let random = Math.random() * totalScore;
        for (const item of scoredMessages) {
            random -= item.score;
            if (random <= 0) {
                return item.message;
            }
        }
        
        return scoredMessages[0].message; // fallback
    }

    // 🔄 봇 지능 초기화 시스템
    resetBotIntelligence(roomCode) {
        console.log(`[봇 지능 초기화] ${roomCode} 방의 모든 봇 지능 시스템을 완전히 초기화합니다.`);
        
        // 게임 히스토리 완전 초기화
        this.gameHistory.delete(roomCode);
        this.initializeRoomHistory(roomCode);
        
        // 봇 성향 재설정
        this.reinitializeBotPersonalities(roomCode);
        
        // 🎭 가짜 경찰 시스템은 보존! (역할 배정 후 리셋되면 안됨)
        // this.fakePoliceBots.delete(roomCode);  // 이 라인 제거!
        // this.fakeInvestigations.delete(roomCode);  // 이 라인 제거!
        
        console.log(`[봇 지능 초기화] ${roomCode} 방의 봇 지능 시스템 초기화 완료 (가짜 경찰 보존)`);
    }

    // 🎭 마피아 봇 중 경찰 연기자 선택
    selectFakePoliceBot(room) {
        const roomCode = room.code;
        
        console.log(`[가짜 경찰 선택 시작] ${roomCode} 방: 마피아 봇 찾는 중...`);
        
        // 마피아 봇들 찾기
        const mafiaBots = [];
        for (const [botId, bot] of room.bots) {
            console.log(`[봇 역할 체크] ${bot.name}: ${bot.role}, 살아있음: ${bot.alive}`);
            if (bot.role === 'mafia' && bot.alive) {
                mafiaBots.push(bot);
            }
        }
        
        console.log(`[마피아 봇 발견] ${roomCode} 방: 총 ${mafiaBots.length}명의 마피아 봇 발견`);
        mafiaBots.forEach(bot => console.log(`  - ${bot.name} (ID: ${bot.id})`));
        
        // 마피아 봇이 2명 이상일 때만 경찰 연기 실행
        if (mafiaBots.length >= 2) {
            // 랜덤하게 한 명 선택
            const selectedBot = mafiaBots[Math.floor(Math.random() * mafiaBots.length)];
            this.fakePoliceBots.set(roomCode, selectedBot.id);
            
            // 가짜 조사 히스토리 초기화
            this.fakeInvestigations.set(roomCode, []);
            
            console.log(`[가짜 경찰 선택 성공] ${roomCode} 방: ${selectedBot.name} (ID: ${selectedBot.id})이 경찰 연기를 담당합니다.`);
            console.log(`[가짜 경찰 선택 확인] fakePoliceBots Map에 저장됨: ${this.fakePoliceBots.get(roomCode)}`);
            return selectedBot.id;
        } else if (mafiaBots.length === 1) {
            // 마피아가 1명뿐이면 경찰 연기 안 함
            console.log(`[가짜 경찰 선택 스킵] ${roomCode} 방: 마피아가 1명뿐이므로 경찰 연기를 하지 않습니다.`);
            return null;
        } else {
            console.log(`[가짜 경찰 선택 실패] ${roomCode} 방: 마피아 봇이 없습니다.`);
            return null;
        }
    }

    // 🎭 가짜 경찰 봇인지 확인
    isFakePoliceBot(roomCode, botId) {
        const fakePoliceBotId = this.fakePoliceBots.get(roomCode);
        const isFake = fakePoliceBotId === botId;
        
        // 💥 강력한 디버깅: 항상 전체 Map 상태 출력
        console.log(`🚨 [가짜 경찰 확인] 방: ${roomCode}, 확인 봇: ${botId}, 가짜 경찰: ${fakePoliceBotId}, 결과: ${isFake}`);
        console.log(`🚨 [전체 Map 상태] fakePoliceBots:`, Array.from(this.fakePoliceBots.entries()));
        console.log(`🚨 [전체 Map 상태] fakeInvestigations:`, Array.from(this.fakeInvestigations.entries()));
        
        return isFake;
    }

    // 🕵️ 거짓 조사 결과 생성
    generateFakeInvestigation(room, fakePoliceBotId) {
        const roomCode = room.code;
        const fakeInvestigations = this.fakeInvestigations.get(roomCode) || [];
        
        // 살아있는 플레이어들 목록 (자신 제외)
        const alivePlayers = this.getAlivePlayers(room).filter(p => p.id !== fakePoliceBotId);
        
        // 이미 조사한(거짓 발표한) 플레이어들 제외
        const investigatedPlayers = new Set(fakeInvestigations.map(inv => inv.target));
        const availableTargets = alivePlayers.filter(p => !investigatedPlayers.has(p.id));
        
        if (availableTargets.length === 0) {
            console.log(`[거짓 조사] ${roomCode}: 더 이상 조사할 대상이 없습니다.`);
            return null;
        }
        
        // 전략적 타겟 선택
        const target = this.chooseFakeInvestigationTarget(room, availableTargets, fakePoliceBotId);
        if (!target) return null;
        
        // 거짓 결과 결정
        const fakeResult = this.decideFakeInvestigationResult(room, target, fakePoliceBotId);
        
        // 거짓 조사 기록 생성
        const fakeInvestigation = {
            investigator: fakePoliceBotId,
            target: target.id,
            targetName: target.name,
            result: fakeResult,
            round: room.round,
            timestamp: new Date(),
            announced: false // 아직 발표되지 않음
        };
        
        // 거짓 조사 히스토리에 저장
        fakeInvestigations.push(fakeInvestigation);
        this.fakeInvestigations.set(roomCode, fakeInvestigations);
        
        console.log(`[거짓 조사 생성] ${roomCode}: ${target.name} → ${fakeResult} (실제 역할: ${target.role})`);
        return fakeInvestigation;
    }

    // 🎯 거짓 조사 대상 선택 (전략적)
    chooseFakeInvestigationTarget(room, availableTargets, fakePoliceBotId) {
        // 우선순위 1: 신뢰도 높은 시민들 (마피아로 몰기 좋은 대상)
        const trustworthyCitizens = availableTargets.filter(p => 
            p.role !== 'mafia' && (p.role === 'citizen' || p.role === 'doctor')
        );
        
        // 우선순위 2: 마피아 동료들 (무고하다고 발표하기 좋은 대상)
        const mafiaAllies = availableTargets.filter(p => p.role === 'mafia');
        
        // 전략 결정: 60% 확률로 시민을 마피아로 몰고, 40% 확률로 마피아를 무고하다고 발표
        const shouldFrameCitizen = Math.random() < 0.6;
        
        if (shouldFrameCitizen && trustworthyCitizens.length > 0) {
            // 시민을 마피아로 몰기 - 신뢰도 높은 시민 우선 선택
            const target = trustworthyCitizens[Math.floor(Math.random() * trustworthyCitizens.length)];
            console.log(`[거짓 조사 전략] 시민 ${target.name}을 마피아로 몰 예정`);
            return target;
        } else if (!shouldFrameCitizen && mafiaAllies.length > 0) {
            // 마피아 동료를 무고하다고 발표
            const target = mafiaAllies[Math.floor(Math.random() * mafiaAllies.length)];
            console.log(`[거짓 조사 전략] 마피아 동료 ${target.name}을 무고하다고 발표할 예정`);
            return target;
        } else if (trustworthyCitizens.length > 0) {
            // 마피아 동료가 없으면 시민을 대상으로
            const target = trustworthyCitizens[Math.floor(Math.random() * trustworthyCitizens.length)];
            console.log(`[거짓 조사 전략] 시민 ${target.name}을 마피아로 몰 예정 (대안)`);
            return target;
        } else {
            // 마지막 수단: 아무나
            const target = availableTargets[Math.floor(Math.random() * availableTargets.length)];
            console.log(`[거짓 조사 전략] 무작위 대상 ${target.name} 선택`);
            return target;
        }
    }

    // 🎲 거짓 조사 결과 결정
    decideFakeInvestigationResult(room, target, fakePoliceBotId) {
        if (target.role === 'mafia') {
            // 마피아 동료는 무고하다고 거짓 발표
            console.log(`[거짓 결과] 마피아 동료 ${target.name}을 무고하다고 거짓 발표`);
            return 'not_mafia';
        } else {
            // 시민은 마피아라고 거짓 발표
            console.log(`[거짓 결과] 시민 ${target.name}을 마피아라고 거짓 발표`);
            return 'mafia';
        }
    }

    // 🎭 거짓 조사 결과 가져오기
    getFakeInvestigations(roomCode, investigatorId = null) {
        const fakeInvestigations = this.fakeInvestigations.get(roomCode) || [];
        
        if (investigatorId) {
            return fakeInvestigations.filter(inv => inv.investigator === investigatorId);
        }
        
        return fakeInvestigations;
    }

    // 🎭 미발표 거짓 조사 결과 가져오기
    getUnnouncedFakeInvestigations(roomCode, investigatorId) {
        const fakeInvestigations = this.getFakeInvestigations(roomCode, investigatorId);
        return fakeInvestigations.filter(inv => !inv.announced);
    }

    // 🎭 거짓 조사 결과를 발표됨으로 표시
    markFakeInvestigationAsAnnounced(roomCode, investigatorId, targetId) {
        const fakeInvestigations = this.fakeInvestigations.get(roomCode) || [];
        const investigation = fakeInvestigations.find(inv => 
            inv.investigator === investigatorId && inv.target === targetId
        );
        
        if (investigation) {
            investigation.announced = true;
            console.log(`[거짓 조사 발표] ${investigation.targetName} 조사 결과 발표 완료`);
        }
    }

    // 봇 성향 재설정
    reinitializeBotPersonalities(roomCode) {
        const room = game.rooms.get(roomCode);
        if (!room) return;
        
        const personalities = ['aggressive', 'cautious', 'analytical', 'intuitive', 'balanced'];
        
        for (const [botId, bot] of room.bots) {
            // 각 봇에게 고유한 성향 할당
            const personality = personalities[Math.floor(Math.random() * personalities.length)];
            
            this.botPersonalities.set(botId, {
                type: personality,
                traits: this.generatePersonalityTraits(personality),
                adaptability: Math.random() * 0.5 + 0.5, // 0.5~1.0 적응력
                consistency: Math.random() * 0.4 + 0.6, // 0.6~1.0 일관성
                smartness: Math.random() * 0.3 + 0.7, // 0.7~1.0 지능
                chatActivity: Math.random() * 0.6 + 0.4 // 0.4~1.0 채팅 활동성
            });
            
            console.log(`[성향 설정] ${bot.name}: ${personality} 성향 (지능: ${this.botPersonalities.get(botId).smartness.toFixed(2)})`);
        }
    }

    // 성향별 특성 생성
    generatePersonalityTraits(personality) {
        const traits = {
            aggressive: {
                votingTendency: 'quick_decision',
                trustThreshold: 0.3,
                suspicionWeight: 1.5,
                chatStyle: 'assertive',
                riskTolerance: 0.8
            },
            cautious: {
                votingTendency: 'careful_analysis',
                trustThreshold: 0.7,
                suspicionWeight: 0.8,
                chatStyle: 'thoughtful',
                riskTolerance: 0.3
            },
            analytical: {
                votingTendency: 'evidence_based',
                trustThreshold: 0.5,
                suspicionWeight: 1.0,
                chatStyle: 'logical',
                riskTolerance: 0.5
            },
            intuitive: {
                votingTendency: 'feeling_based',
                trustThreshold: 0.6,
                suspicionWeight: 1.2,
                chatStyle: 'emotional',
                riskTolerance: 0.6
            },
            balanced: {
                votingTendency: 'mixed_approach',
                trustThreshold: 0.5,
                suspicionWeight: 1.0,
                chatStyle: 'neutral',
                riskTolerance: 0.5
            }
        };
        
        return traits[personality] || traits.balanced;
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

        // 🆕 봇 반응형 채팅 트리거 - 실제 플레이어 발언에만 반응
        console.log(`[반응형 채팅 검사] 메시지 타입: ${messageData.type}, 방 존재: ${!!room}, 플레이어ID: ${messageData.playerId}, 봇인가: ${this.isBot(messageData.playerId, room)}`);
        console.log(`[반응형 채팅 상세] 메시지: "${messageData.message}", 플레이어 이름: ${messageData.playerName}`);
        
        if (messageData.type === 'player' && room && !this.isBot(messageData.playerId, room)) {
            console.log(`[반응형 채팅 트리거] 조건 만족! 실제 플레이어 메시지: "${messageData.message}"`);
            console.log(`[반응형 채팅 트리거] triggerReactiveBotChats 호출 시작`);
            this.triggerReactiveBotChats(room, chatMessage);
            console.log(`[반응형 채팅 트리거] triggerReactiveBotChats 호출 완료`);
        } else {
            console.log(`[반응형 채팅 건너뛰기] 조건 불만족 - 타입:${messageData.type}, 방:${!!room}, 봇여부:${this.isBot(messageData.playerId, room)}`);
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

    // 🆕 플레이어가 실제로 채팅을 했는지 확인하는 함수
    hasPlayerChatted(roomCode, playerId) {
        const history = this.gameHistory.get(roomCode);
        if (!history) return false;
        
        const playerStatements = history.playerStatements.get(playerId);
        if (!playerStatements) return false;
        
        return playerStatements.totalMessages > 0;
    }

    // 🆕 현재 라운드에서 플레이어가 채팅을 했는지 확인하는 함수
    hasPlayerChattedThisRound(roomCode, playerId, currentRound) {
        const history = this.gameHistory.get(roomCode);
        if (!history) return false;
        
        const playerStatements = history.playerStatements.get(playerId);
        if (!playerStatements) return false;
        
        // 현재 라운드에서 발언한 메시지가 있는지 확인
        return playerStatements.messageTimings.some(timing => timing.round === currentRound);
    }

    // 🆕 채팅한 플레이어들만 필터링하는 함수
    filterPlayersWhoChatted(roomCode, players) {
        if (!players || players.length === 0) return [];
        
        return players.filter(playerData => {
            const playerId = playerData.player ? playerData.player.id : playerData.id;
            return this.hasPlayerChatted(roomCode, playerId);
        });
    }

    // 역할 주장 추출 (자신의 역할을 주장하는 경우만)
    extractRoleClaim(message) {
        // "나는/내가" 등 1인칭 표현이 있는 경우만 역할 주장으로 간주
        const selfReferencePatterns = ['나는', '내가', '저는', '제가', '난', '내'];
        const hasSelfReference = selfReferencePatterns.some(pattern => message.includes(pattern));
        
        if (!hasSelfReference) {
            // 1인칭 표현이 없으면 다른 사람에 대한 언급일 가능성이 높음
            return null;
        }
        
        // 1인칭 표현이 있는 경우에만 역할 주장으로 판단
        if (message.includes('시민')) return 'citizen';
        if (message.includes('경찰')) return 'police';
        if (message.includes('의사')) return 'doctor';
        if (message.includes('마피아')) return 'mafia';
        if (message.includes('마법사')) return 'wizard';
        if (message.includes('조커')) return 'joker';
        if (message.includes('무당')) return 'shaman';
        return null;
    }

    // 정보 주장 추출
    extractInformationClaim(message) {
        if (message.includes('조사')) {
            // "ㅁㅁ님이 마피아입니다" 같은 패턴에서 타겟과 결과 추출
            let target = null;
            let result = null;
            
            // 마피아 결과 패턴 감지
            if (message.includes('마피아입니다') || message.includes('마피아예요') || message.includes('마피아였') || message.includes('마피아네요')) {
                result = 'mafia';
            } else if (message.includes('시민입니다') || message.includes('시민이에요') || message.includes('시민이었') || message.includes('시민이네요') || 
                      message.includes('무고') || message.includes('시민') || message.includes('아니') || message.includes('아님')) {
                result = 'not_mafia';
            }
            
            return {
                type: 'investigation',
                target: target, // 실제 구현에서는 메시지에서 플레이어 이름 추출 필요
                result: result
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

    // 🔧 개선된 채팅 기반 신뢰도 계산 시스템
    calculateChatTrust(playerId, history, room) {
        const playerStatements = history.playerStatements.get(playerId);
        if (!playerStatements) return 0; // 채팅 안 한 플레이어는 중립

        let chatTrust = 0;
        const playerPersonality = this.botPersonalities.get(playerId);
        
        // 1. 발언 일관성 분석 (거짓말쟁이는 모순 발언을 한다)
        chatTrust += this.analyzeStatementConsistency(playerId, playerStatements, history);
        
        // 2. 행동과 발언 일치성 분석 (말과 행동이 다르면 거짓말)
        chatTrust += this.analyzeActionStatementAlignment(playerId, playerStatements, history, room);
        
        // 3. 정보 주장의 정확성 검증 (거짓 정보를 퍼뜨리는지)
        chatTrust += this.verifyInformationClaims(playerId, playerStatements, history, room);
        
        // 4. 과도한 주장/확신 탐지 - 완화됨
        chatTrust += this.analyzeExcessiveConfidence(playerId, playerStatements);
        
        // 5. 방어 패턴 분석 - 완화됨
        chatTrust += this.analyzeDefensivePatterns(playerId, playerStatements);
        
        // 6. 타이밍과 반응 패턴 분석 - 완화됨
        chatTrust += this.analyzeTimingAndReactions(playerId, playerStatements, history, playerPersonality);

        // 🆕 7. 건설적 기여도 분석 (긍정적 행동에 대한 보상)
        chatTrust += this.analyzeConstructiveContribution(playerId, playerStatements, history);

        // 🆕 8. 성향별 조정 (성향에 따라 일부 패턴은 정상적일 수 있음)
        chatTrust = this.adjustForPersonality(chatTrust, playerPersonality);

        console.log(`[채팅 분석] ${playerId}: 채팅 신뢰도 ${chatTrust}점`);
        return Math.max(-30, Math.min(30, chatTrust)); // -30 ~ +30 점 범위 (완화됨)
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

    // 3. 정보 주장의 정확성 검증 - 개선됨
    verifyInformationClaims(playerId, playerStatements, history, room) {
        let accuracy = 0;
        
        // 경찰 조사 결과 주장 검증
        for (const claim of playerStatements.informationClaims) {
            if (claim.type === 'investigation') {
                // 🔍 실제 조사 기록 확인 (가장 중요)
                const actualInvestigations = this.findPlayerInvestigations(playerId, history);
                
                if (actualInvestigations.length > 0) {
                    // 실제로 조사를 한 경우 - 진짜 경찰일 가능성 높음
                    accuracy += 25; // 대폭 증가 (실제 조사 기록이 최고 증거)
                    console.log(`[정보검증] ${playerId}: 실제 조사 기록 존재 - 진짜 경찰 (+25)`);
                    
                    // 추가 보너스: 조사 결과를 정확히 발표했는지 확인
                    for (const actualInv of actualInvestigations) {
                        // 실제 조사 결과와 발표 내용이 일치하는지 확인 (간단한 검증)
                        accuracy += 10; // 정확한 정보 발표 보너스
                        console.log(`[정보검증] ${playerId}: 조사 결과 정확 발표 (+10)`);
                    }
                } else {
                    // 실제 조사하지 않았는데 조사 정보 주장
                    const policeClaims = playerStatements.roleClaims.filter(rc => rc.role === 'police');
                    
                    if (policeClaims.length > 0) {
                        // 경찰 주장했지만 조사 기록 없음 - 의심스러움
                        accuracy -= 5; // 완화된 페널티
                        console.log(`[정보검증] ${playerId}: 경찰 주장했으나 조사 기록 없음 (-5)`);
                    } else {
                        // 경찰 아닌데 조사 정보 주장 - 거짓말 가능성
                        accuracy -= 8; // 완화된 페널티
                        console.log(`[정보검증] ${playerId}: 경찰 아닌데 조사 정보 주장 (-8)`);
                    }
                }
                
                // 🆕 추가 검증: 조사 정보의 구체성과 타이밍
                if (claim.round && claim.phase) {
                    // 적절한 타이밍에 발표한 경우 (아침 또는 토론 시간)
                    if (claim.phase === 'morning' || claim.phase === 'discussion') {
                        accuracy += 5; // 적절한 타이밍 보너스
                        console.log(`[정보검증] ${playerId}: 적절한 타이밍의 정보 발표 (+5)`);
                    }
                }
            }
        }

        return accuracy;
    }

    // 플레이어의 모든 조사 기록 찾기 (헬퍼 함수) - 개선됨
    findPlayerInvestigations(playerId, history) {
        const investigations = [];
        
        // 1. 현재 라운드에서 조사 기록 확인
        if (history.currentRound && history.currentRound.investigations && history.currentRound.investigations.length > 0) {
            for (const inv of history.currentRound.investigations) {
                if (inv.investigator === playerId) {
                    investigations.push(inv);
                }
            }
        }
        
        // 2. 완료된 라운드들에서 조사 기록 확인
        for (const round of history.rounds) {
            if (round.investigations && round.investigations.length > 0) {
                for (const inv of round.investigations) {
                    if (inv.investigator === playerId) {
                        investigations.push(inv);
                    }
                }
            }
        }
        
        return investigations;
    }

    // 4. 과도한 주장/확신 탐지 - 크게 완화됨
    analyzeExcessiveConfidence(playerId, playerStatements) {
        let confidence = 0;
        
        const totalMessages = playerStatements.totalMessages;
        const suspicionClaims = playerStatements.suspicionClaims.length;
        const trustClaims = playerStatements.trustClaims.length;
        const roleClaims = playerStatements.roleClaims.length;
        const informationClaims = playerStatements.informationClaims.length;
        
        // 의견 표현 비율 분석 - 더욱 완화
        if (totalMessages > 0) {
            const opinionRatio = (suspicionClaims + trustClaims) / totalMessages;
            
            // 🆕 정보 제공자에게는 페널티 없음
            if (informationClaims > 0) {
                console.log(`[과도한확신] ${playerId}: 정보 제공자 - 의견 표현 페널티 면제`);
            } else if (opinionRatio > 0.95) { // 95% 이상만 페널티 (매우 완화)
                confidence -= 2; // 매우 완화된 페널티
                console.log(`[과도한확신] ${playerId}: 극도의 의견 표현 (-2)`);
            }
        }

        // 역할 주장 분석 - 완화
        if (roleClaims > 5) { // 5개 이상으로 대폭 완화
            confidence -= 2; // 완화된 페널티
            console.log(`[과도한확신] ${playerId}: 극도의 역할 주장 (-2)`);
        } else if (roleClaims > 3) { // 3개 이상
            confidence -= 1; // 경미한 페널티
            console.log(`[과도한확신] ${playerId}: 많은 역할 주장 (-1)`);
        }
        
        // 🆕 건설적 참여 보상
        if (totalMessages >= 2 && informationClaims > 0) {
            confidence += 3; // 정보 제공자 보상
            console.log(`[과도한확신] ${playerId}: 정보 제공자 보상 (+3)`);
        }

        return confidence;
    }

    // 5. 방어 패턴 분석 - 대폭 완화됨
    analyzeDefensivePatterns(playerId, playerStatements) {
        let defense = 0;
        
        const defensiveCount = playerStatements.defensiveStatements.length;
        const totalMessages = playerStatements.totalMessages;
        const informationClaims = playerStatements.informationClaims.length;
        
        if (totalMessages > 0) {
            const defensiveRatio = defensiveCount / totalMessages;
            
            // 🆕 정보 제공자나 경찰 역할 주장자는 방어적 발언이 정당할 수 있음
            const hasPoliceRoleClaim = playerStatements.roleClaims.some(claim => claim.role === 'police');
            
            if (informationClaims > 0 || hasPoliceRoleClaim) {
                // 정보 제공자는 의심받을 때 방어할 권리가 있음
                console.log(`[방어패턴] ${playerId}: 정보 제공자 - 방어적 발언 페널티 면제`);
            } else if (defensiveRatio > 0.8) { // 80% 이상만 페널티 (매우 완화)
                defense -= 3; // 대폭 완화된 페널티
                console.log(`[방어패턴] ${playerId}: 극도의 방어적 발언 (-3)`);
            } else if (defensiveRatio > 0.6) { // 60% 이상
                defense -= 1; // 경미한 페널티
                console.log(`[방어패턴] ${playerId}: 방어적 성향 (-1)`);
            }
            
            // 🆕 적절한 방어는 오히려 정상적인 시민 반응일 수 있음
            if (defensiveRatio > 0 && defensiveRatio <= 0.3 && totalMessages >= 3) {
                defense += 1; // 적절한 방어 보상
                console.log(`[방어패턴] ${playerId}: 적절한 방어 반응 (+1)`);
            }
        }

        return defense;
    }

    // 6. 타이밍과 반응 패턴 분석 - 완화됨
    analyzeTimingAndReactions(playerId, playerStatements, history, playerPersonality) {
        let timing = 0;
        
        const messageTimings = playerStatements.messageTimings;
        
        // 토론 시간 활용 패턴 - 완화됨
        const discussionMessages = messageTimings.filter(msg => msg.phase === 'discussion');
        if (discussionMessages.length === 0 && playerStatements.totalMessages > 0) {
            // 성향에 따라 조정
            if (playerPersonality && playerPersonality.traits.chatStyle === 'thoughtful') {
                timing -= 1; // 신중한 성향은 말을 적게 할 수 있음
                console.log(`[타이밍] ${playerId}: 신중한 성향으로 토론 참여 적음 (-1)`);
            } else {
                timing -= 3; // 기본 감점 완화
                console.log(`[타이밍] ${playerId}: 토론 시간 비참여 (-3)`);
            }
        }

        // 투표 직전 발언 패턴 분석 - 완화됨
        const lastMinuteMessages = discussionMessages.filter(msg => {
            return msg.phase === 'discussion'; // 실제로는 시간 계산 필요
        });
        
        const hasInformationClaims = playerStatements.informationClaims.length > 0;
        const hasPoliceRoleClaim = playerStatements.roleClaims.some(claim => claim.role === 'police');
        
        // 경찰 역할 주장자가 정보 제공하는 경우는 정상적인 타이밍으로 간주
        if (lastMinuteMessages.length > discussionMessages.length * 0.5) {
            if (hasInformationClaims && hasPoliceRoleClaim) {
                // 경찰이 조사 결과를 발표하는 경우 - 정상적인 행동
                console.log(`[타이밍] ${playerId}: 경찰 조사 결과 발표 - 정상 타이밍`);
            } else if (playerPersonality && playerPersonality.traits.votingTendency === 'quick_decision') {
                // 공격적 성향은 마지막 순간 발언이 정상적
                timing -= 1; // 완화된 감점
                console.log(`[타이밍] ${playerId}: 공격적 성향의 마지막 순간 발언 (-1)`);
            } else {
                timing -= 2; // 기본 감점 완화 (기존 -3에서 -2로)
                console.log(`[타이밍] ${playerId}: 마지막 순간 발언 편중 (-2)`);
            }
        }

        return timing;
    }

    // 🆕 7. 건설적 기여도 분석 (긍정적 행동에 대한 강화된 보상)
    analyzeConstructiveContribution(playerId, playerStatements, history) {
        let contribution = 0;
        
        // 🔍 정보 공유 행동 대폭 보상 강화
        if (playerStatements.informationClaims.length > 0) {
            const infoBonus = Math.min(15, playerStatements.informationClaims.length * 8); // 정보당 8점, 최대 15점
            contribution += infoBonus;
            console.log(`[건설적 기여] ${playerId}: 정보 제공 강화 보상 (+${infoBonus})`);
            
            // 🆕 조사 정보 제공 특별 보상
            const investigationClaims = playerStatements.informationClaims.filter(ic => ic.type === 'investigation');
            if (investigationClaims.length > 0) {
                contribution += 10; // 조사 정보 특별 보상
                console.log(`[건설적 기여] ${playerId}: 조사 정보 특별 보상 (+10)`);
            }
        }
        
        // 🆕 경찰 역할 주장자 보상
        const hasPoliceRoleClaim = playerStatements.roleClaims.some(claim => claim.role === 'police');
        if (hasPoliceRoleClaim) {
            contribution += 8; // 경찰 주장자 보상
            console.log(`[건설적 기여] ${playerId}: 경찰 역할 주장 (+8)`);
        }
        
        // 논리적 추리 보상 강화
        if (playerStatements.suspicionClaims.length > 0 && playerStatements.suspicionClaims.length <= 4) {
            const reasoningBonus = Math.min(6, playerStatements.suspicionClaims.length * 2);
            contribution += reasoningBonus;
            console.log(`[건설적 기여] ${playerId}: 합리적 의심 표현 (+${reasoningBonus})`);
        }
        
        // 균형잡힌 발언 보상
        const totalStatements = playerStatements.suspicionClaims.length + playerStatements.trustClaims.length;
        if (totalStatements > 0 && totalStatements <= playerStatements.totalMessages * 0.6) { // 60%로 완화
            contribution += 3; // 보상 증가
            console.log(`[건설적 기여] ${playerId}: 균형잡힌 발언 (+3)`);
        }
        
        // 적극적 참여 보상 강화
        if (playerStatements.totalMessages >= 2) { // 기준 완화
            const participationBonus = Math.min(4, playerStatements.totalMessages); // 메시지당 1점, 최대 4점
            contribution += participationBonus;
            console.log(`[건설적 기여] ${playerId}: 적극적 참여 (+${participationBonus})`);
        }
        
        // 🆕 신뢰 표현 보상 (마피아는 주로 의심만 함)
        if (playerStatements.trustClaims.length > 0) {
            contribution += 2; // 신뢰 표현 보상
            console.log(`[건설적 기여] ${playerId}: 신뢰 표현 (+2)`);
        }
        
        return contribution;
    }

    // 🆕 8. 성향별 조정 (성향에 따라 일부 패턴은 정상적일 수 있음)
    adjustForPersonality(chatTrust, playerPersonality) {
        if (!playerPersonality) return chatTrust;
        
        const personality = playerPersonality.type;
        const traits = playerPersonality.traits;
        
        // 성향별 조정
        switch (personality) {
            case 'aggressive':
                // 공격적 성향은 빠른 의사결정과 적극적 발언이 정상
                if (chatTrust < 0) {
                    chatTrust = Math.max(chatTrust * 0.7, -20); // 부정적 점수 완화
                }
                break;
            case 'cautious':
                // 신중한 성향은 방어적 발언과 적은 발언이 정상
                if (chatTrust < 0) {
                    chatTrust = Math.max(chatTrust * 0.8, -15); // 부정적 점수 완화
                }
                break;
            case 'analytical':
                // 분석적 성향은 정보 제공과 논리적 추리가 정상
                if (chatTrust > 0) {
                    chatTrust = Math.min(chatTrust * 1.2, 25); // 긍정적 점수 증가
                }
                break;
            case 'intuitive':
                // 직관적 성향은 감정적 발언과 빠른 판단이 정상
                chatTrust = chatTrust * 0.9; // 전반적으로 완화
                break;
            case 'balanced':
                // 균형잡힌 성향은 현재 그대로
                break;
        }
        
        return Math.round(chatTrust);
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
        const nightSurvival = this.analyzeNightSurvival(playerId, history);
        trust += (isNaN(nightSurvival) ? 0 : nightSurvival);
        
        // 2. 투표 패턴 분석 (밤에 죽은 플레이어와의 관계)
        const votingPatterns = this.analyzeVotingPatterns(playerId, history);
        trust += (isNaN(votingPatterns) ? 0 : votingPatterns);
        
        // 3. 경찰 조사 결과 활용 (자신이 경찰인 경우에만)
        const investigationResults = this.analyzeInvestigationResults(playerId, history);
        trust += (isNaN(investigationResults) ? 0 : investigationResults);
        
        // 4. 공격 대상 패턴 분석 (누가 밤에 죽었는지)
        const attackPatterns = this.analyzeAttackPatterns(playerId, history);
        trust += (isNaN(attackPatterns) ? 0 : attackPatterns);
        
        // 5. 📢 채팅 분석 (거짓말 탐지 및 진실 분석)
        let chatTrust = 0;
        if (room) {
            chatTrust = this.calculateChatTrust(playerId, history, room);
            chatTrust = isNaN(chatTrust) ? 0 : chatTrust;
            trust += chatTrust;
        }
        
        // 최종 안전성 확인
        if (isNaN(trust) || trust === null || trust === undefined) {
            trust = 50;
        }
        
        const baseTrust = Math.round(trust - chatTrust);
        const finalChatTrust = Math.round(chatTrust);
        const finalTrust = Math.round(trust);
        
        console.log(`[종합 신뢰도] ${playerId}: 기본 ${baseTrust}점 + 채팅 ${finalChatTrust}점 = 총 ${finalTrust}점`);
        
        return Math.max(0, Math.min(100, Math.round(trust)));
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
            investigations: roundData.investigations || [],
            spiritInvestigations: roundData.spiritInvestigations || [],
            roleSwaps: roundData.roleSwaps || []
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
        
        // 봇 지능 시스템도 함께 초기화
        this.resetBotIntelligence(roomCode);
    }

    // === 역할별 전략 로직 ===

    // 마피아 봇 전략 (🚫 치팅 방지 - 의사와 동등한 수준으로 제한)
    chooseMafiaTarget(room, mafiaBot) {
        console.log(`[마피아 AI] ${mafiaBot.name}: 단순 공격 전략 시작`);
        
        const alivePlayers = this.getAlivePlayers(room).filter(p => p.id !== mafiaBot.id);
        
        // 🎲 **핵심**: 마피아도 80% 확률로 완전 무작위 선택 (의사와 완전히 동등한 수준)
        if (Math.random() < 0.8) {
            const mafiaAllies = alivePlayers.filter(p => p.role === 'mafia');
            const nonMafiaTargets = alivePlayers.filter(p => p.role !== 'mafia');
            
            if (nonMafiaTargets.length > 0) {
                const randomTarget = nonMafiaTargets[Math.floor(Math.random() * nonMafiaTargets.length)];
                console.log(`[마피아 완전 무작위] ${mafiaBot.name}: ${randomTarget.name} 완전 무작위 공격 (80% 확률)`);
                return randomTarget;
            }
        }
        
        // 🔄 20% 확률로만 기본적인 전략 (고급 추리 시스템 사용 안 함)
        console.log(`[마피아 AI] ${mafiaBot.name}: 기본 전략 (20% 확률)`);
        
        const basicAnalysis = this.analyzeGameState(room);
        if (!basicAnalysis) {
            const nonMafiaTargets = alivePlayers.filter(p => p.role !== 'mafia');
            if (nonMafiaTargets.length > 0) {
                const fallbackTarget = nonMafiaTargets[Math.floor(Math.random() * nonMafiaTargets.length)];
                console.log(`[마피아 fallback] ${mafiaBot.name}: ${fallbackTarget.name} fallback 공격`);
                return fallbackTarget;
            }
        }

        // 매우 기본적인 공격 로직만 사용 (고급 추리 없음)
        const nonMafiaPlayers = alivePlayers.filter(p => p.role !== 'mafia');

        // 우선순위 1: 위험한 역할 (경찰, 의사로 추정되는 플레이어) - 하지만 추리 능력 제한
        if (basicAnalysis.threats && basicAnalysis.threats.length > 0) {
            const threats = basicAnalysis.threats.filter(t => t.player.id !== mafiaBot.id && t.player.role !== 'mafia');
            
            if (threats.length > 0) {
                // 상위 3명 중 무작위 선택
                const topThreats = threats.slice(0, 3);
                const target = topThreats[Math.floor(Math.random() * topThreats.length)].player;
                console.log(`[마피아 기본 위험 인물] ${mafiaBot.name}: ${target.name} 선택`);
                return target;
            }
        }

        // 우선순위 2: 신뢰도가 높은 플레이어 - 하지만 무작위성 추가
        if (basicAnalysis.trustedPlayers && basicAnalysis.trustedPlayers.length > 0) {
            const trustedNonMafia = basicAnalysis.trustedPlayers.filter(p => p.player.id !== mafiaBot.id && p.player.role !== 'mafia');

            if (trustedNonMafia.length > 0) {
                // 상위 3명 중 무작위 선택
                const topTrusted = trustedNonMafia.slice(0, 3);
                const target = topTrusted[Math.floor(Math.random() * topTrusted.length)].player;
                console.log(`[마피아 기본 신뢰 플레이어] ${mafiaBot.name}: ${target.name} 선택`);
                return target;
            }
        }

        // 우선순위 3: 완전 무작위 선택 (마피아 제외)
        const finalTargets = alivePlayers.filter(p => p.role !== 'mafia');
        if (finalTargets.length > 0) {
            const randomTarget = finalTargets[Math.floor(Math.random() * finalTargets.length)];
            console.log(`[마피아 완전 무작위 fallback] ${mafiaBot.name}: ${randomTarget.name} 무작위 공격`);
            return randomTarget;
        }

        console.log(`[마피아 AI] ${mafiaBot.name}: 공격할 대상이 없음`);
        return null;
    }

    // 스마트 마피아 타겟 선택
    chooseSmartMafiaTarget(room, mafiaBot, analysis) {
        const candidates = [];
        
        // 모든 플레이어 프로필 분석
        for (const [playerId, profile] of analysis.playerProfiles) {
            if (playerId === mafiaBot.id) continue;
            
            // 🚨 **핵심**: 마피아 팀원 제외 (게임 규칙상 마피아는 서로를 공격하면 안됨)
            const player = room.players.get(playerId) || room.bots.get(playerId);
            if (player && player.role === 'mafia') {
                console.log(`[마피아 팀원 제외] ${mafiaBot.name}: ${player.name}은 마피아 동료이므로 공격 대상에서 제외`);
                continue;
            }
            
            let priority = 0;
            const reasons = [];
            
            // 우선순위 1: 경찰 (최고 우선순위)
            if (profile.suspectedRole === 'police') {
                priority += 100;
                reasons.push('경찰 역할 추정');
            }
            
            // 우선순위 2: 의사 (두 번째 우선순위)
            if (profile.suspectedRole === 'doctor') {
                priority += 90;
                reasons.push('의사 역할 추정');
            }
            
            // 우선순위 3: 신뢰도 높은 시민 (영향력 있는 플레이어)
            if (profile.trustLevel > 70) {
                priority += 70;
                reasons.push('높은 신뢰도');
            }
            
            // 우선순위 4: 추리 능력이 뛰어난 플레이어
            if (profile.keyTraits.includes('정보 제공') || profile.keyTraits.includes('논리적 추리')) {
                priority += 60;
                reasons.push('추리 능력 위험');
            }
            
            // 우선순위 5: 마피아 의심을 받지 않는 플레이어
            if (profile.mafiaLikelihood < 20) {
                priority += 50;
                reasons.push('마피아 의심 없음');
            }
            
            // 감점 요소: 이미 의심받는 플레이어는 우선순위 낮음
            if (profile.mafiaLikelihood > 60) {
                priority -= 30;
                reasons.push('이미 의심받음');
            }
            
            if (priority > 0) {
                candidates.push({
                    player: { id: playerId, name: profile.playerName },
                    priority: priority,
                    reasons: reasons,
                    profile: profile
                });
            }
        }
        
        if (candidates.length === 0) return null;
        
        // 우선순위 정렬
        candidates.sort((a, b) => b.priority - a.priority);
        
        const topCandidate = candidates[0];
        console.log(`[스마트 마피아 선택] ${mafiaBot.name}: ${topCandidate.player.name} 선택 (우선순위: ${topCandidate.priority}, 이유: ${topCandidate.reasons.join(', ')})`);
        
        return topCandidate.player;
    }

    // 의사 봇 전략 (🚫 완전 단순화 - 치팅 방지)
    chooseDoctorTarget(room, doctorBot) {
        console.log(`[의사 AI] ${doctorBot.name}: 단순 보호 전략 시작`);
        
        const alivePlayers = this.getAlivePlayers(room).filter(p => p.id !== doctorBot.id);
        
        // 🎲 **핵심**: 의사는 80% 확률로 완전 무작위 선택 (마피아 예측 불가능)
        if (Math.random() < 0.8) {
            const randomTarget = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
            console.log(`[의사 완전 무작위] ${doctorBot.name}: ${randomTarget.name} 완전 무작위 보호 (80% 확률)`);
            return randomTarget;
        }
        
        // 🔄 20% 확률로만 기본적인 전략 (고급 추리 시스템 사용 안 함)
        console.log(`[의사 AI] ${doctorBot.name}: 기본 전략 (20% 확률)`);
        
        const basicAnalysis = this.analyzeGameState(room);
        if (!basicAnalysis) {
            const fallbackTarget = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
            console.log(`[의사 fallback] ${doctorBot.name}: ${fallbackTarget.name} fallback 보호`);
            return fallbackTarget;
        }

        // 매우 기본적인 보호 로직만 사용 (고급 추리 없음)
        const protectionTargets = basicAnalysis.protectionTargets.filter(t => t.player.id !== doctorBot.id);
        if (protectionTargets.length > 0) {
            // 상위 3명 중 무작위 선택
            const topTargets = protectionTargets.slice(0, 3);
            const target = topTargets[Math.floor(Math.random() * topTargets.length)].player;
            console.log(`[의사 기본 보호] ${doctorBot.name}: ${target.name} 기본 보호 선택`);
            return target;
        }

        // 완전 무작위 fallback
        const randomTarget = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
        console.log(`[의사 완전 무작위 fallback] ${doctorBot.name}: ${randomTarget.name} 무작위 보호`);
        return randomTarget;
    }

    // 스마트 의사 타겟 선택 (🔄 완전히 새로운 로직)
    chooseSmartDoctorTarget(room, doctorBot, analysis) {
        const alivePlayers = this.getAlivePlayers(room).filter(p => p.id !== doctorBot.id);
        
        // 🎲 **핵심**: 의사는 60% 확률로 무작위 선택 (마피아 예측 방지)
        if (Math.random() < 0.6) {
            const randomTarget = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
            console.log(`[의사 무작위 선택] ${doctorBot.name}: ${randomTarget.name} 무작위 보호 (60% 확률)`);
            return randomTarget;
        }
        
        const candidates = [];
        
        // 40% 확률로만 전략적 선택
        for (const [playerId, profile] of analysis.playerProfiles) {
            if (playerId === doctorBot.id) continue;
            
            let priority = 0;
            const reasons = [];
            
            // 🔄 **새로운 우선순위**: 경찰만 확실히 보호
            if (profile.suspectedRole === 'police') {
                priority += 90;
                reasons.push('경찰 보호');
            }
            
            // 🔄 **새로운 우선순위**: 다른 의사 보호
            if (profile.suspectedRole === 'doctor') {
                priority += 80;
                reasons.push('의사 보호');
            }
            
            // 🔄 **변경된 로직**: 마피아 의심을 받지 않는 플레이어는 제외 (마피아와 겹치지 않도록)
            if (profile.mafiaLikelihood > 30 && profile.mafiaLikelihood < 70) {
                priority += 30;
                reasons.push('중간 의심도 플레이어');
            }
            
            // 🔄 **새로운 우선순위**: 생존 패턴이 위험한 플레이어 (마피아가 노릴 만한)
            if (profile.keyTraits.includes('정보 제공')) {
                priority += 25;
                reasons.push('정보 제공자 보호');
            }
            
            // 🔄 **완전히 다른 기준**: 기본 보호 대상 (낮은 우선순위)
            if (priority === 0) {
                priority = Math.floor(Math.random() * 20) + 10; // 10-30 랜덤
                reasons.push('기본 보호 대상');
            }
            
            candidates.push({
                player: { id: playerId, name: profile.playerName },
                priority: priority,
                reasons: reasons,
                profile: profile
            });
        }
        
        if (candidates.length === 0) {
            // fallback: 완전 무작위
            const randomTarget = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
            console.log(`[의사 완전 무작위] ${doctorBot.name}: ${randomTarget.name} 완전 무작위 보호`);
            return randomTarget;
        }
        
        // 🎲 상위 3명 중에서 무작위 선택 (예측 불가능하게)
        const topCandidates = candidates.sort((a, b) => b.priority - a.priority).slice(0, 3);
        const selectedCandidate = topCandidates[Math.floor(Math.random() * topCandidates.length)];
        
        console.log(`[스마트 의사 선택] ${doctorBot.name}: ${selectedCandidate.player.name} 선택 (우선순위: ${selectedCandidate.priority}, 이유: ${selectedCandidate.reasons.join(', ')}) - 상위 ${topCandidates.length}명 중 무작위`);
        
        return selectedCandidate.player;
    }

    // 경찰 봇 전략 (개선됨)
    choosePoliceTarget(room, policeBot) {
        console.log(`[경찰 AI] ${policeBot.name}: 고급 추리 시작`);
        
        // 고급 추리 시스템 사용
        const analysis = this.performAdvancedDeduction(room, policeBot);
        if (analysis && analysis.playerProfiles.size > 0) {
            const smartTarget = this.chooseSmartPoliceTarget(room, policeBot, analysis);
            if (smartTarget) {
                return smartTarget;
            }
        }
        
        // 기존 로직 fallback
        const basicAnalysis = this.analyzeGameState(room);
        if (!basicAnalysis) return this.chooseRandomTarget(room, policeBot, 'police');

        console.log(`[경찰 AI] ${policeBot.name}: 기본 전략으로 전환`);

        // 우선순위 1: 의심도가 높은 플레이어
        const suspiciousPlayers = basicAnalysis.suspiciousPlayers.filter(p => 
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

        const uninvestigatedPlayers = basicAnalysis.alivePlayers.filter(p => 
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

    // 스마트 경찰 타겟 선택
    chooseSmartPoliceTarget(room, policeBot, analysis) {
        const candidates = [];
        const history = this.gameHistory.get(room.code);
        
        // 이미 조사한 플레이어 목록
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
        
        // 모든 플레이어 프로필 분석
        for (const [playerId, profile] of analysis.playerProfiles) {
            if (playerId === policeBot.id) continue;
            if (investigatedPlayers.has(playerId)) continue; // 이미 조사함
            
            let priority = 0;
            const reasons = [];
            
            // 우선순위 1: 마피아 가능성 높은 플레이어
            if (profile.mafiaLikelihood > 70) {
                priority += 100;
                reasons.push('마피아 가능성 높음');
            } else if (profile.mafiaLikelihood > 50) {
                priority += 80;
                reasons.push('마피아 가능성 있음');
            }
            
            // 우선순위 2: 의심스러운 행동 패턴
            if (profile.keyTraits.includes('모순 발언')) {
                priority += 70;
                reasons.push('모순 발언');
            }
            
            if (profile.keyTraits.includes('거짓 정보')) {
                priority += 60;
                reasons.push('거짓 정보 제공');
            }
            
            // 우선순위 3: 역할 불명확한 플레이어
            if (profile.suspectedRole === 'unknown') {
                priority += 40;
                reasons.push('역할 불명확');
            }
            
            // 우선순위 4: 생존 패턴 의심
            if (profile.keyTraits.includes('오래 생존')) {
                priority += 30;
                reasons.push('생존 패턴 의심');
            }
            
            // 감점 요소: 이미 신뢰받는 플레이어는 우선순위 낮음
            if (profile.trustLevel > 70) {
                priority -= 20;
                reasons.push('신뢰받는 플레이어');
            }
            
            if (priority > 0) {
                candidates.push({
                    player: { id: playerId, name: profile.playerName },
                    priority: priority,
                    reasons: reasons,
                    profile: profile
                });
            }
        }
        
        if (candidates.length === 0) return null;
        
        // 우선순위 정렬
        candidates.sort((a, b) => b.priority - a.priority);
        
        const topCandidate = candidates[0];
        console.log(`[스마트 경찰 선택] ${policeBot.name}: ${topCandidate.player.name} 선택 (우선순위: ${topCandidate.priority}, 이유: ${topCandidate.reasons.join(', ')})`);
        
        return topCandidate.player;
    }

    // 시민 봇 전략
    chooseCitizenVoteTarget(room, citizenBot) {
        const analysis = this.analyzeGameState(room);
        if (!analysis) return this.chooseRandomTarget(room, citizenBot, 'citizen');

        console.log(`[시민 AI] ${citizenBot.name}: 전략적 투표 대상 선택 시작`);
        
        const history = this.gameHistory.get(room.code);
        const alivePlayers = this.getAlivePlayers(room).filter(p => p.id !== citizenBot.id);

        // 우선순위 1: 채팅 분석에서 역할 주장 모순이나 정보 검증 실패한 플레이어
        if (history && history.playerStatements) {
            for (const player of alivePlayers) {
                const playerData = history.playerStatements.get(player.id);
                if (playerData && playerData.contradictions && Array.isArray(playerData.contradictions)) {
                    if (playerData.contradictions.length > 0) {
                        console.log(`[시민 AI] ${citizenBot.name}: 모순 발견 플레이어 ${player.name} 투표 선택 (모순: ${playerData.contradictions.length}개)`);
                        return player;
                    }
                }
            }
        }

        // 우선순위 2: 의심도가 높은 플레이어 (임계값 낮춤)
        const suspiciousPlayers = analysis.suspiciousPlayers.filter(p => 
            p.player.id !== citizenBot.id && p.suspicion > 25
        );

        if (suspiciousPlayers.length > 0) {
            const target = suspiciousPlayers[0].player;
            console.log(`[시민 AI] ${citizenBot.name}: 의심스러운 플레이어 ${target.name} 투표 선택 (의심도: ${suspiciousPlayers[0].suspicion})`);
            return target;
        }

        // 우선순위 3: 신뢰도가 낮은 플레이어
        const lowTrustPlayers = analysis.trustedPlayers.filter(p => 
            p.player.id !== citizenBot.id && p.trust < 40
        ).sort((a, b) => a.trust - b.trust);

        if (lowTrustPlayers.length > 0) {
            const target = lowTrustPlayers[0].player;
            console.log(`[시민 AI] ${citizenBot.name}: 신뢰도 낮은 플레이어 ${target.name} 투표 선택 (신뢰도: ${lowTrustPlayers[0].trust})`);
            return target;
        }

        // 우선순위 4: 무작위 선택 (자신 제외)
        console.log(`[시민 AI] ${citizenBot.name}: 전략적 대상 없음, 무작위 선택`);
        return this.chooseRandomTarget(room, citizenBot, 'citizen');
    }

    // 마피아 봇 투표 전략 (개선됨)
    chooseMafiaVoteTarget(room, mafiaBot) {
        console.log(`[마피아 투표 AI] ${mafiaBot.name}: 고급 추리 시작`);
        
        // 🚨 **핵심**: 마피아 동료 보호 시스템
        const allPlayers = [...room.players.values(), ...room.bots.values()];
        const mafiaMembers = allPlayers.filter(p => p.role === 'mafia' && p.alive);
        console.log(`[마피아 동료 보호] ${mafiaBot.name}: 마피아 동료 ${mafiaMembers.length}명 보호`);
        
        // 고급 추리 시스템 사용
        const smartChoice = this.makeSmartVoteDecision(room, mafiaBot);
        if (smartChoice) {
            return smartChoice;
        }

        // 기존 로직 fallback
        const analysis = this.analyzeGameState(room);
        if (!analysis) return this.chooseRandomTarget(room, mafiaBot, 'mafia');

        console.log(`[마피아 투표 AI] ${mafiaBot.name}: 기본 전략으로 전환`);
        
        const history = this.gameHistory.get(room.code);
        let alivePlayers = this.getAlivePlayers(room).filter(p => p.id !== mafiaBot.id);

        // 🚨 **핵심**: 마피아 동료들을 투표 후보에서 제외
        alivePlayers = alivePlayers.filter(p => p.role !== 'mafia');
        console.log(`[마피아 동료 제외] ${mafiaBot.name}: 마피아 동료들을 투표 후보에서 제외`);

        // 우선순위 1: 역할 주장자 (경찰, 의사 주장) 제거
        if (history && history.playerStatements) {
            const roleClaimTargets = [];
            
            for (const player of alivePlayers) {
                const playerData = history.playerStatements.get(player.id);
                if (playerData && playerData.roleClaims) {
                    const dangerousClaims = playerData.roleClaims.filter(claim => 
                        claim.role === 'police' || claim.role === 'doctor'
                    );
                    if (dangerousClaims.length > 0) {
                        roleClaimTargets.push({
                            player: player,
                            claimedRole: dangerousClaims[0].role,
                            claimCount: dangerousClaims.length
                        });
                    }
                }
            }

            if (roleClaimTargets.length > 0) {
                // 경찰 주장자를 우선적으로 타겟
                const policeClaims = roleClaimTargets.filter(t => t.claimedRole === 'police');
                if (policeClaims.length > 0) {
                    const target = policeClaims[0].player;
                    console.log(`[마피아 투표 AI] ${mafiaBot.name}: 경찰 주장자 ${target.name} 투표 선택`);
                    return target;
                }

                // 의사 주장자 타겟
                const doctorClaims = roleClaimTargets.filter(t => t.claimedRole === 'doctor');
                if (doctorClaims.length > 0) {
                    const target = doctorClaims[0].player;
                    console.log(`[마피아 투표 AI] ${mafiaBot.name}: 의사 주장자 ${target.name} 투표 선택`);
                    return target;
                }
            }
        }

        // 우선순위 2: 신뢰도가 높은 플레이어 (영향력 있는 시민 제거)
        if (analysis.trustedPlayers && analysis.trustedPlayers.length > 0) {
            const trustedTargets = analysis.trustedPlayers.filter(p => 
                p.player.id !== mafiaBot.id && p.trust > 60 && p.player.role !== 'mafia'
            );

            if (trustedTargets.length > 0) {
                const target = trustedTargets[0].player;
                console.log(`[마피아 투표 AI] ${mafiaBot.name}: 신뢰받는 시민 ${target.name} 투표 선택 (신뢰도: ${trustedTargets[0].trust})`);
                return target;
            }
        }

        // 우선순위 3: 의심도가 낮은 무고한 플레이어 (쉽게 제거 가능)
        if (alivePlayers.length > 0) {
            const suspicions = alivePlayers.map(p => ({
                player: p,
                suspicion: this.calculateSuspicion(p.id, history || { rounds: [] })
            })).sort((a, b) => a.suspicion - b.suspicion);

            const target = suspicions[0].player;
            console.log(`[마피아 투표 AI] ${mafiaBot.name}: 무고한 시민 ${target.name} 투표 선택 (의심도: ${suspicions[0].suspicion})`);
            return target;
        }

        // 우선순위 4: 무작위 선택
        console.log(`[마피아 투표 AI] ${mafiaBot.name}: 전략적 대상 없음, 무작위 선택`);
        return this.chooseRandomTarget(room, mafiaBot, 'mafia');
    }

    // 마법사 봇 전략
    chooseWizardTarget(room, wizardBot) {
        const analysis = this.analyzeGameState(room);
        if (!analysis) return this.chooseRandomTarget(room, wizardBot, 'wizard');

        console.log(`[마법사 AI] ${wizardBot.name}: 전략적 대상 선택 시작`);

        // 30% 확률로 능력 사용하지 않음 (너무 자주 사용하면 의심받음)
        if (Math.random() < 0.3) {
            console.log(`[마법사 AI] ${wizardBot.name}: 능력 사용하지 않음 (30% 확률)`);
            return null;
        }

        const history = this.gameHistory.get(room.code);
        const alivePlayers = this.getAlivePlayers(room).filter(p => p.id !== wizardBot.id);
        const aliveCount = alivePlayers.length;

        // 게임 상황에 따른 전략 선택
        const isEarlyGame = room.round <= 2;
        const isLateGame = aliveCount <= 4;

        console.log(`[마법사 AI] ${wizardBot.name}: 게임 상황 분석 - 라운드: ${room.round}, 생존자: ${aliveCount}명, 초반: ${isEarlyGame}, 후반: ${isLateGame}`);

        // 전략 1: 후반전에서는 마피아 역할 노리기 (승리 조건 유리)
        if (isLateGame && analysis.suspiciousPlayers && analysis.suspiciousPlayers.length > 0) {
            const highSuspicionTargets = analysis.suspiciousPlayers.filter(p => 
                p.player.id !== wizardBot.id && p.suspicion > 70
            );
            
            if (highSuspicionTargets.length > 0) {
                const target = highSuspicionTargets[0].player;
                console.log(`[마법사 AI] ${wizardBot.name}: 후반전 마피아 의심 플레이어 ${target.name} 타겟 (의심도: ${highSuspicionTargets[0].suspicion})`);
                return target;
            }
        }

        // 전략 2: 경찰/의사 역할 주장자 우선 타겟 (특수 능력 획득)
        if (history && history.playerStatements) {
            const roleClaimTargets = [];
            
            for (const player of alivePlayers) {
                const playerData = history.playerStatements.get(player.id);
                if (playerData && playerData.roleClaims) {
                    const specialRoleClaims = playerData.roleClaims.filter(claim => 
                        claim.role === 'police' || claim.role === 'doctor'
                    );
                    if (specialRoleClaims.length > 0) {
                        roleClaimTargets.push({
                            player: player,
                            claimedRole: specialRoleClaims[0].role,
                            claimCount: specialRoleClaims.length
                        });
                    }
                }
            }

            if (roleClaimTargets.length > 0) {
                // 경찰 주장자를 우선적으로 타겟
                const policeClaims = roleClaimTargets.filter(t => t.claimedRole === 'police');
                if (policeClaims.length > 0) {
                    const target = policeClaims[0].player;
                    console.log(`[마법사 AI] ${wizardBot.name}: 경찰 주장자 ${target.name} 타겟 (조사 능력 획득 목적)`);
                    return target;
                }

                // 의사 주장자 타겟
                const doctorClaims = roleClaimTargets.filter(t => t.claimedRole === 'doctor');
                if (doctorClaims.length > 0) {
                    const target = doctorClaims[0].player;
                    console.log(`[마법사 AI] ${wizardBot.name}: 의사 주장자 ${target.name} 타겟 (치료 능력 획득 목적)`);
                    return target;
                }
            }
        }

        // 전략 3: 초반에는 신뢰도 높은 플레이어 타겟 (영향력 획득)
        if (isEarlyGame && analysis.trustedPlayers && analysis.trustedPlayers.length > 0) {
            const highTrustTargets = analysis.trustedPlayers.filter(p => 
                p.player.id !== wizardBot.id && p.trust > 65
            );
            
            if (highTrustTargets.length > 0) {
                const target = highTrustTargets[0].player;
                console.log(`[마법사 AI] ${wizardBot.name}: 초반 신뢰받는 플레이어 ${target.name} 타겟 (영향력 획득, 신뢰도: ${highTrustTargets[0].trust})`);
                return target;
            }
        }

        // 전략 4: 중간 의심도 플레이어 타겟 (안전한 선택)
        if (analysis.suspiciousPlayers && analysis.suspiciousPlayers.length > 0) {
            const moderateSuspicionTargets = analysis.suspiciousPlayers.filter(p => 
                p.player.id !== wizardBot.id && p.suspicion > 45 && p.suspicion < 70
            );
            
            if (moderateSuspicionTargets.length > 0) {
                const target = moderateSuspicionTargets[0].player;
                console.log(`[마법사 AI] ${wizardBot.name}: 중간 의심도 플레이어 ${target.name} 타겟 (의심도: ${moderateSuspicionTargets[0].suspicion})`);
                return target;
            }
        }

        // 전략 5: 무작위 선택 (40% 확률로만)
        if (Math.random() < 0.4) {
            const randomTarget = this.chooseRandomTarget(room, wizardBot, 'wizard');
            if (randomTarget) {
                console.log(`[마법사 AI] ${wizardBot.name}: 무작위 플레이어 ${randomTarget.name} 타겟`);
                return randomTarget;
            }
        }

        // 전략 6: 능력 사용 안 함
        console.log(`[마법사 AI] ${wizardBot.name}: 적절한 타겟이 없어 능력 사용하지 않음`);
        return null;
    }

    // 무작위 대상 선택 (기본 전략)
    chooseRandomTarget(room, bot, role) {
        const alivePlayers = this.getAlivePlayers(room);
        let targets = [];

        if (role === 'mafia') {
            // 마피아는 자신과 다른 마피아 제외 (마피아는 팀원을 알고 있음)
            targets = alivePlayers.filter(p => {
                if (p.id === bot.id) return false; // 자신 제외
                
                // 같은 마피아 팀원 제외 (게임 규칙상 마피아는 서로 알고 있음)
                const playerObj = room.players.get(p.id) || room.bots.get(p.id);
                return playerObj ? playerObj.role !== 'mafia' : true;
            });
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

    // 무당 봇의 타겟 선택 (죽은 플레이어 조사)
    chooseShamanTarget(room, shamanBot) {
        const deadPlayers = [];
        
        // 죽은 플레이어들 찾기
        for (const player of room.players.values()) {
            if (!player.alive) {
                deadPlayers.push(player);
            }
        }
        for (const bot of room.bots.values()) {
            if (!bot.alive) {
                deadPlayers.push(bot);
            }
        }
        
        if (deadPlayers.length === 0) {
            console.log(`[무당 AI] ${shamanBot.name}: 조사할 죽은 플레이어가 없음`);
            return null;
        }
        
        // 이미 조사한 죽은 플레이어들 확인
        const history = this.gameHistory.get(room.code);
        const investigatedDeadPlayers = new Set();
        
        if (history) {
            // 1. 현재 라운드에서 이미 조사한 플레이어들 확인
            if (history.currentRound && history.currentRound.spiritInvestigations) {
                for (const investigation of history.currentRound.spiritInvestigations) {
                    if (investigation.investigator === shamanBot.id) {
                        investigatedDeadPlayers.add(investigation.target);
                        console.log(`[무당 조사 히스토리] ${shamanBot.name}: 현재 라운드에서 ${investigation.target} 이미 조사함`);
                    }
                }
            }
            
            // 2. 완료된 라운드들에서 이미 조사한 플레이어들 확인
            for (const round of history.rounds) {
                if (round.spiritInvestigations) {
                    for (const investigation of round.spiritInvestigations) {
                        if (investigation.investigator === shamanBot.id) {
                            investigatedDeadPlayers.add(investigation.target);
                            console.log(`[무당 조사 히스토리] ${shamanBot.name}: 라운드 ${round.round}에서 ${investigation.target} 이미 조사함`);
                        }
                    }
                }
            }
        }
        
        // 아직 조사하지 않은 죽은 플레이어들만 필터링
        const uninvestigatedDeadPlayers = deadPlayers.filter(p => !investigatedDeadPlayers.has(p.id));
        
        console.log(`[무당 조사 필터링] ${shamanBot.name}: 전체 죽은 플레이어 ${deadPlayers.length}명, 이미 조사한 플레이어 ${investigatedDeadPlayers.size}명, 미조사 플레이어 ${uninvestigatedDeadPlayers.length}명`);
        
        if (uninvestigatedDeadPlayers.length === 0) {
            console.log(`[무당 AI] ${shamanBot.name}: 모든 죽은 플레이어를 이미 조사함`);
            return null;
        }
        
        // 가장 최근에 죽은 플레이어를 우선 선택
        const target = uninvestigatedDeadPlayers[uninvestigatedDeadPlayers.length - 1];
        console.log(`[무당 AI] ${shamanBot.name}: ${target.name} 조사 선택 (죽은 플레이어, 미조사)`);
        
        return target;
    }

    // 플레이어 역할 확인 (게임 로직에서 사용)
    getPlayerRole(room, playerId) {
        const player = room.players.get(playerId) || room.bots.get(playerId);
        return player ? player.role : null;
    }

    // === 봇 채팅 시스템 ===

    // 봇 채팅 메시지 생성 및 전송
    generateBotChat(room, bot, phase, context = {}) {
        if (!room || !bot || !bot.alive) return;

        const message = this.createChatMessage(room, bot, phase, context);
        if (!message) return;

        console.log(`[봇 채팅] ${bot.name} (${bot.role}): ${message}`);

        // 채팅 메시지를 AI 히스토리에 저장
        this.addChatMessage(room.code, {
            type: 'player',
            playerId: bot.id,
            playerName: bot.name,
            message,
            round: room.round,
            gamePhase: phase
        }, room);

        // 방 전체에 채팅 메시지 전송
        io.to(room.code).emit('chatMessage', {
            type: 'player',
            playerName: bot.name,
            message,
            timestamp: new Date()
        });
    }

    // 마피아 봇 전용 채팅 생성
    generateMafiaChat(room, mafiaBot, context = {}) {
        if (!room || !mafiaBot || !mafiaBot.alive || mafiaBot.role !== 'mafia') return;

        const message = this.createMafiaChatMessage(room, mafiaBot, context);
        if (!message) return;

        console.log(`[마피아 채팅] ${mafiaBot.name}: ${message}`);

        // 마피아 채팅 메시지를 AI 히스토리에 저장
        this.addChatMessage(room.code, {
            type: 'mafia_chat',
            playerId: mafiaBot.id,
            playerName: mafiaBot.name,
            message,
            round: room.round,
            gamePhase: 'night'
        }, room);

        // 마피아 팀원들에게만 메시지 전송
        const allPlayers = [...room.players.values(), ...room.bots.values()];
        const mafiaMembers = allPlayers.filter(p => p.role === 'mafia' && p.alive);
        
        for (const mafia of mafiaMembers) {
            if (!mafia.isBot) { // 실제 플레이어에게만 전송
                io.to(mafia.id).emit('mafiaChatMessage', {
                    type: 'mafia',
                    playerName: mafiaBot.name,
                    message,
                    timestamp: new Date()
                });
            }
        }
    }

    // 일반 채팅 메시지 생성
    createChatMessage(room, bot, phase, context) {
        const history = this.gameHistory.get(room.code);
        if (!history) return null;

        const alivePlayers = this.getAlivePlayers(room);
        const suspiciousPlayers = this.getMostSuspiciousPlayers(history, alivePlayers);
        const trustedPlayers = this.getMostTrustedPlayers(history, alivePlayers, room);

        switch (bot.role) {
            case 'citizen':
                return this.createCitizenMessage(room, bot, phase, context, suspiciousPlayers, trustedPlayers);
            case 'police':
                return this.createPoliceMessage(room, bot, phase, context, suspiciousPlayers, trustedPlayers);
            case 'doctor':
                return this.createDoctorMessage(room, bot, phase, context, suspiciousPlayers, trustedPlayers);
            case 'shaman':
                return this.createShamanMessage(room, bot, phase, context, suspiciousPlayers, trustedPlayers);
            case 'mafia':
                return this.createMafiaMessage(room, bot, phase, context, suspiciousPlayers, trustedPlayers);
            default:
                return null;
        }
    }

    // 시민 봇 메시지 생성 (디시인사이드 말투) - 🆕 대폭 개선된 다양성 시스템
    createCitizenMessage(room, bot, phase, context, suspiciousPlayers, trustedPlayers) {
        // 고급 추리 시스템 사용
        const analysis = this.performAdvancedDeduction(room, bot);
        
        if (analysis && analysis.playerProfiles.size > 0) {
            return this.createSmartCitizenMessage(room, bot, phase, context, analysis);
        }
        
        // 🆕 감정 상태 업데이트
        const alivePlayers = this.getAlivePlayers(room);
        this.updateEmotionalState(bot.id, {
            round: room.round,
            alivePlayers: alivePlayers.length,
            suspiciousPlayers: suspiciousPlayers,
            recentDeaths: context.nightResults ? 1 : 0
        });
        
        const emotionalState = this.emotionalStates.get(bot.id);
        
        // 🆕 대폭 확장된 메시지 풀 (감정 상태별)
        let baseMessages = [];
        
        // 기본 마피아 찾기 메시지 (평상시)
        if (!emotionalState || emotionalState.tension < 0.7) {
            baseMessages = [
                "마피아들 어디있노 ㅋㅋ",
                "누가 마피아인지 개궁금함",
                "증거 봐야 투표하지 ㅇㅇ",
                "신중하게 해야지 노답게임 되면 ㅅㅂ",
                "마피아 숨어있는거 티남 ㅋㅋㅋ",
                "진짜 마피아 누구임?",
                "다들 어케 생각하는거임?",
                "뭔가 이상한뎅...",
                "확실한 증거 없으면 노답",
                "마피아 개빨리 찾자 진짜 ㅋㅋ",
                "이거 진짜 어렵네 ㅗㅗ",
                "추리하는거 ㅈㄴ 힘들어",
                "실화냐 이거?",
                "마피아 존나 잘 숨었네",
                "단서라도 있었으면 좋겠는데",
                "솔직히 누가 의심됨?",
                "마피아새끼들 개교활함",
                "이런 겜이 재밌나 싶기도하고",
                "머리 터질거같아 진짜",
                "논리적으로 생각해보자",
                "뭔가 놓친게 있을텐데",
                "마피아 찾는게 이렇게 어려웠나?",
                "다들 연기를 너무 잘해 ㅅㅂ",
                "의심가는 사람 좀 있긴한데",
                "확신이 안서네 진짜",
                "투표 잘못하면 개망함",
                "시민끼리 싸우면 안되는데",
                "마피아가 웃고있을거야",
                "신중하게 판단하자고",
                "정보가 부족해 개답답함",
                "누구 말을 믿어야할지 모르겠어",
                "마피아 개짜증나네 진짜",
                "이 중에 진짜 마피아 있음?",
                "뭔가 수상한 냄새가 남",
                "직감적으로 이상한 사람 있음",
                "말이 앞뒤 안맞는 놈 있지않나?",
                "행동패턴 보면 알 수 있을텐데",
                "마피아는 시민인척 연기하잖아",
                "누가 거짓말하고 있는거임?",
                "시민이면 당당해야지",
                "뭔가 이상한 기운이 느껴짐",
                "마피아 냄새나는 사람 있어",
                "다들 너무 평온한데 괜찮나?",
                "의심스러운 발언 한 사람 없나?",
                "누구 투표 패턴이 이상했지?",
                "마피아면 티날텐데..."
            ];
        } else {
            // 고긴장 상태 메시지 (위험한 상황)
            baseMessages = [
                "ㅅㅂ 이제 정말 위험해졌어",
                "마피아 진짜 빨리 찾아야함!!",
                "개긴장되네 진짜 ㅗㅗ",
                "이제 실수하면 게임 끝남",
                "누가 마피아인지 확실히 알아야해",
                "시간 없어!! 빨리 결정하자",
                "이번이 마지막 기회일수도...",
                "개떨리네 ㅅㅂ",
                "마피아 놈들 이제 티 날거야",
                "절대 속으면 안됨!!",
                "지금까지 힌트 종합해보자",
                "누가 제일 수상했는지 생각해봐",
                "개중요한 순간이야 진짜",
                "틀리면 다 죽어 ㅅㅂ",
                "마피아 새끼 어디있어!!",
                "이거 진짜 목숨걸린 문제야",
                "누구든 확신있으면 말해줘",
                "지금 아니면 기회 없어",
                "개판날거같은 예감",
                "마지막까지 포기하면 안돼"
            ];
        }
        
        // 🆕 분노 상태 메시지 추가
        if (emotionalState && emotionalState.anger > 0.5) {
            baseMessages.push(
                "ㅅㅂ 누가 나 의심함??",
                "개빡치네 진짜",
                "억울하게 몰아가지마",
                "나 시민인데 왜 의심해??",
                "진짜 화나네 ㅗㅗ",
                "말도안되는 의심하지마",
                "증거도 없으면서 뭔소리야",
                "개억울해 진짜",
                "마피아가 나 몰아가는거 아냐?"
            );
        }
        
        // 🆕 특정 플레이어에 대한 의심 메시지 (동적 생성)
        const filteredSuspiciousPlayers = suspiciousPlayers.filter(p => p.player.id !== bot.id);
        const chattedSuspiciousPlayers = this.filterPlayersWhoChatted(room.code, filteredSuspiciousPlayers);
        if (chattedSuspiciousPlayers.length > 0) {
            const target = chattedSuspiciousPlayers[0];
            const suspicionMessages = [
                `${target.player.name} 개의심스러움 ㅋㅋ`,
                `${target.player.name} 행동이 개이상함`,
                `${target.player.name} 좀 수상한뎅?`,
                `${target.player.name} 마피아 아님? ㅋㅋㅋ`,
                `${target.player.name} 말이 이상해`,
                `${target.player.name} 뭔가 숨기는거같음`,
                `${target.player.name} 연기하는거 티남`,
                `${target.player.name} 개수상해 진짜`,
                `${target.player.name} 눈빛이 이상함 ㅋㅋ`,
                `${target.player.name} 거짓말쟁이 같은뎅`,
                `${target.player.name} 마피아일 확률 높음`,
                `${target.player.name} 투표 패턴도 이상하고`,
                `${target.player.name} 진짜 의심됨 ㅅㅂ`,
                `${target.player.name} 얘 마피아 맞지?`,
                `${target.player.name} 도망가려는거 같은데`
            ];
            baseMessages.push(...suspicionMessages);
        }
        
        // 🆕 신뢰하는 플레이어 메시지 (동적 생성)
        const filteredTrustedPlayers = trustedPlayers.filter(p => p.player.id !== bot.id);
        if (filteredTrustedPlayers.length > 0) {
            const trusted = filteredTrustedPlayers[0];
            const trustMessages = [
                `${trusted.player.name}은 믿을만함 ㅇㅇ`,
                `${trusted.player.name} 시민 같은뎅`,
                `${trusted.player.name} 개착해 보임`,
                `${trusted.player.name} 진짜 같은편인듯`,
                `${trusted.player.name} 말이 논리적임`,
                `${trusted.player.name} 시민티 개많이남`,
                `${trusted.player.name} 얘는 진짜 시민일거야`,
                `${trusted.player.name} 믿고 따라가자`
            ];
            baseMessages.push(...trustMessages);
        }
        
        // 🆕 페이즈별 메시지 추가
        if (phase === 'voting') {
            baseMessages.push(
                "투표 신중하게 하자고",
                "잘못 투표하면 개망함",
                "누구 투표할지 정했음?",
                "확신없으면 투표하지마",
                "이번 투표가 중요해",
                "마피아한테 투표해야함",
                "시민 죽이면 안돼 절대",
                "투표 이유라도 말해줘",
                "개중요한 선택이야",
                "틀리면 게임 끝날수도",
                "누구 손 들지 고민되네",
                "확실한 마피아 없나?"
            );
        } else if (phase === 'discussion') {
            baseMessages.push(
                "토론 제대로 하자",
                "정보 공유 좀 해줘",
                "뭔가 알고있는거 없어?",
                "다들 의견 말해봐",
                "추리 같이 해보자",
                "단서 찾아보자고",
                "의심스러운 사람 있으면 말해",
                "증거 있는 사람?",
                "지금까지 무슨일 있었지?",
                "밤에 뭔일 일어났나?",
                "누구 죽었는지 확인해봐",
                "경찰이나 의사 정보 있어?"
            );
        }
        
        // 🆕 다양성 시스템 적용한 메시지 선택
        const selectedMessage = this.selectDiverseMessage(bot.id, baseMessages);
        
        // 사용된 메시지 기록
        if (selectedMessage) {
            this.recordUsedMessage(bot.id, selectedMessage);
        }
        
        return selectedMessage || "마피아 찾아야지...";
    }

    // 스마트 시민 메시지 생성 (디시인사이드 말투)
    createSmartCitizenMessage(room, bot, phase, context, analysis) {
        const messages = [];
        
        // 마피아 의심자에 대한 논리적 추리
        const highSuspicionPlayers = Array.from(analysis.playerProfiles.values())
            .filter(p => p.mafiaLikelihood > 60)
            .sort((a, b) => b.mafiaLikelihood - a.mafiaLikelihood);
        
        if (highSuspicionPlayers.length > 0) {
            const suspect = highSuspicionPlayers[0];
            const reasons = suspect.keyTraits.slice(0, 2).join(', ');
            messages.push(`${suspect.playerName} 개의심스러움. ${reasons} ㅋㅋ`);
            messages.push(`${suspect.playerName} 행동패턴이 마피아 같은뎅?`);
            messages.push(`${suspect.playerName} 진짜 개수상함 ㅅㅂ`);
        }
        
        // 경찰 조사 결과 활용
        const policeResults = this.getPoliceResultsFromAnalysis(analysis);
        if (policeResults.length > 0) {
            const result = policeResults[0];
            if (result.result === 'mafia') {
                messages.push(`경찰이 ${result.target} 마피아라고 했음!`);
                messages.push(`${result.target} 마피아 확실함! 투표각!`);
            } else {
                messages.push(`경찰이 ${result.target} 무고하다고 했음`);
                messages.push(`${result.target} 시민 맞나봄 ㅇㅇ`);
            }
        }
        
        // 투표 패턴 분석 공유 (자기 자신 제외)
        const votingInsights = this.generateVotingInsights(analysis, bot.id, room);
        if (votingInsights) {
            messages.push(votingInsights);
        }
        
        // 생존 패턴 분석 공유 (자기 자신 제외)
        const survivalInsights = this.generateSurvivalInsights(analysis, bot.id, room);
        if (survivalInsights) {
            messages.push(survivalInsights);
        }
        
        // 기본 메시지 (디시인사이드 말투)
        if (messages.length === 0) {
            messages.push("신중하게 분석해야함 ㅇㅇ");
            messages.push("모든 정보 종합해서 생각해야지 진짜");
            messages.push("뭔가 단서가 있을텐데 ㅋㅋ");
            messages.push("누가 마피아임? 답답해");
        }
        
        return messages[Math.floor(Math.random() * messages.length)];
    }

    // 경찰 봇 메시지 생성 (디시인사이드 말투) - 🆕 대폭 개선된 다양성 시스템
    createPoliceMessage(room, bot, phase, context, suspiciousPlayers, trustedPlayers) {
        const analysis = this.performAdvancedDeduction(room, bot);
        
        if (analysis && analysis.playerProfiles.size > 0) {
            return this.createSmartPoliceMessage(room, bot, phase, context, analysis);
        }
        
        // 🆕 감정 상태 업데이트
        const alivePlayers = this.getAlivePlayers(room);
        this.updateEmotionalState(bot.id, {
            round: room.round,
            alivePlayers: alivePlayers.length,
            suspiciousPlayers: suspiciousPlayers,
            recentDeaths: context.nightResults ? 1 : 0
        });
        
        const emotionalState = this.emotionalStates.get(bot.id);
        
        // 🆕 대폭 확장된 경찰 메시지 풀 (감정 상태별)
        let baseMessages = [];
        
        // 기본 경찰 업무 메시지 (평상시)
        if (!emotionalState || emotionalState.tension < 0.7) {
            baseMessages = [
                "조사결과 분석중임 ㅇㅇ",
                "증거 보고 투표할거임",
                "마피아 찾으려고 개노력중",
                "정확한 정보 줄게 기다려",
                "내가 경찰이니까 믿어줘 제발",
                "수사진행중임 ㅋㅋ",
                "마피아들 개잡아버릴거임",
                "조사결과 곧 알려줄게 ㅇㅇ",
                "진짜 경찰이 여기있어요",
                "범인찾기 ㅈㄴ 어렵네",
                "경찰 믿고 따라와 제발",
                "수사정보 차근차근 정리중",
                "단서들 조합해서 분석해봄",
                "경찰 직감으로는 뭔가 이상함",
                "체계적으로 조사할거야",
                "마피아 놈들 꼬리 잡힐거임",
                "내 수사실력 믿어봐",
                "경찰로서 책임감 느껴",
                "정의구현 하려고 하는중",
                "범죄자들 다 잡아버림",
                "수사망 좁혀가고 있어",
                "진실은 하나뿐이야",
                "증거주의 원칙 지킬거임",
                "의심가는 놈들 다 체크중",
                "경찰 본능이 말하는데",
                "수사기법 총동원할거야",
                "진짜 경찰이 해결한다",
                "사건해결까지 포기안해",
                "마피아들 절대 못 숨어",
                "경찰서에서 배운대로 할게",
                "수사의 신이 될거야 ㅋㅋ",
                "범인검거가 내 사명임",
                "정확한 조사로 승부본다",
                "경찰 뱃지가 내 자존심",
                "마피아 색출작전 진행중",
                "수사본능이 꿈틀거려"
            ];
        } else {
            // 고긴장 상태 메시지 (위험한 상황)
            baseMessages = [
                "ㅅㅂ 시간 없어!! 빨리 조사해야함",
                "지금까지 조사결과 총정리한다!!",
                "경찰로서 마지막 수사다!!",
                "개중요한 순간이야 믿어줘!!",
                "이번에 못잡으면 다 죽어!!",
                "경찰 생명걸고 수사했어!!",
                "마피아 새끼들 이제 끝이야!!",
                "수사결과 발표할 시간이다!!",
                "경찰이 책임진다!! 따라와!!",
                "진실 밝혀내겠어 개빡쳐!!",
                "마피아놈들 관련자 다 잡아!!",
                "경찰서 명예걸고 해결한다!!",
                "범인 확정지었어!! 들어봐!!",
                "수사종료!! 결론 발표한다!!",
                "경찰 직감이 확신한다!!",
                "이제 모든걸 밝혀낼 때야!!",
                "마지막 기회다!! 믿어줘!!",
                "수사완료!! 범인 지목한다!!",
                "경찰로서 최종결론 내림!!",
                "진실은 이거다!! 확신해!!"
            ];
        }
        
        // 🆕 역할 의심받을 때 방어 메시지
        if (emotionalState && emotionalState.anger > 0.5) {
            baseMessages.push(
                "야 나 진짜 경찰이야!!",
                "경찰 의심하지마 제발!!",
                "내가 가짜 경찰이라고?? ㅅㅂ",
                "진짜 경찰인데 왜 안믿어??",
                "조사결과 보고도 의심함??",
                "경찰서에서 파견나온거야!!",
                "가짜경찰이랑 다르다고!!",
                "내 조사실력 의심하지마!!",
                "경찰 뱃지 보여줄까??",
                "마피아가 나 몰아가는거야!!"
            );
        }
        
        // 🆕 조사 대상에 대한 메시지 (동적 생성)
        const filteredSuspiciousPlayers = suspiciousPlayers.filter(p => p.player.id !== bot.id);
        const chattedSuspiciousPlayers = this.filterPlayersWhoChatted(room.code, filteredSuspiciousPlayers);
        if (chattedSuspiciousPlayers.length > 0) {
            const target = chattedSuspiciousPlayers[0];
            const investigationMessages = [
                `${target.player.name} 수사대상 1순위임`,
                `${target.player.name} 행동이 수상해서 조사중`,
                `${target.player.name} 경찰 직감으로는 의심됨`,
                `${target.player.name} 수사망에 걸렸어`,
                `${target.player.name} 조사해볼 필요있음`,
                `${target.player.name} 프로파일링 결과 수상`,
                `${target.player.name} 경찰 본능이 말함`,
                `${target.player.name} 범죄자 냄새남`,
                `${target.player.name} 수사리스트 상위권`,
                `${target.player.name} 마피아일 가능성 검토중`,
                `${target.player.name} 증거수집 진행중`,
                `${target.player.name} 수사파일 만들고있어`
            ];
            baseMessages.push(...investigationMessages);
        }
        
        // 🆕 신뢰하는 플레이어에 대한 메시지 (동적 생성)
        const filteredTrustedPlayers = trustedPlayers.filter(p => p.player.id !== bot.id);
        if (filteredTrustedPlayers.length > 0) {
            const trusted = filteredTrustedPlayers[0];
            const trustMessages = [
                `${trusted.player.name} 수사결과 깨끗함`,
                `${trusted.player.name} 경찰이 보증한다`,
                `${trusted.player.name} 시민으로 확신`,
                `${trusted.player.name} 무혐의 처리함`,
                `${trusted.player.name} 신뢰할만한 인물`,
                `${trusted.player.name} 경찰 인증받음`,
                `${trusted.player.name} 선량한 시민임`,
                `${trusted.player.name} 수사에서 제외`
            ];
            baseMessages.push(...trustMessages);
        }
        
        // 🆕 페이즈별 메시지 추가
        if (phase === 'voting') {
            baseMessages.push(
                "경찰 수사결과 기준으로 투표해",
                "내 조사 믿고 투표하자",
                "경찰이 확신하는 후보 있어",
                "수사증거 보고 결정해줘",
                "경찰 정보 활용해서 투표",
                "조사결과가 투표 근거야",
                "경찰 직감 맞춰봐",
                "수사완료된 대상 투표하자",
                "경찰이 책임지고 지목함",
                "조사자료 검토 후 투표해"
            );
        } else if (phase === 'discussion') {
            baseMessages.push(
                "수사정보 공유할게",
                "조사과정 설명해줄까?",
                "경찰 관점에서 분석해봄",
                "수사결과 듣고싶으면 말해",
                "범죄수법 분석해봤어",
                "경찰 전문지식 공유함",
                "수사기법으로 추리해보자",
                "조사보고서 작성중",
                "경찰서 교육받은대로 분석",
                "수사자료 정리해서 발표할게",
                "형사의 직감이 말하는데",
                "범죄심리학적으로 보면"
            );
        }
        
        // 🆕 다양성 시스템 적용한 메시지 선택
        const selectedMessage = this.selectDiverseMessage(bot.id, baseMessages);
        
        // 사용된 메시지 기록
        if (selectedMessage) {
            this.recordUsedMessage(bot.id, selectedMessage);
        }
        
        return selectedMessage || "경찰로서 수사를 계속한다...";
    }

    // 스마트 경찰 메시지 생성 - 개선됨
    createSmartPoliceMessage(room, bot, phase, context, analysis) {
        const messages = [];
        const history = this.gameHistory.get(room.code);
        
        // 🔍 조사 결과 발표 (아침/토론 시간에 우선적으로)
        if ((phase === 'discussion' || phase === 'morning') && history) {
            let investigationsToCheck = [];
            
            // 1. 먼저 현재 라운드(currentRound)에서 조사 결과 확인
            if (history.currentRound && history.currentRound.investigations && history.currentRound.investigations.length > 0) {
                investigationsToCheck = history.currentRound.investigations;
                console.log(`[경찰 메시지] ${bot.name}: 현재 라운드 ${room.round} 조사 결과 확인 중...`);
            }
            // 2. 현재 라운드에 없으면 마지막 완료된 라운드에서 확인
            else if (history.rounds.length > 0) {
            const lastRound = history.rounds[history.rounds.length - 1];
                if (lastRound.investigations && lastRound.investigations.length > 0) {
                    investigationsToCheck = lastRound.investigations;
            console.log(`[경찰 메시지] ${bot.name}: 라운드 ${lastRound.round} 조사 결과 확인 중...`);
                }
            }
            
            // 조사 결과가 있으면 발표
            if (investigationsToCheck.length > 0) {
                for (const investigation of investigationsToCheck) {
                    console.log(`[경찰 메시지] 조사 기록: ${investigation.investigator} → ${investigation.target} (${investigation.result})`);
                    
                    if (investigation.investigator === bot.id) {
                        const targetName = this.getPlayerName(investigation.target, room);
                        if (investigation.result === 'mafia') {
                            console.log(`[경찰 결과 발표] ${bot.name}: ${targetName} 마피아 발표`);
                            const mafiaAnnouncements = [
                                `야! ${targetName} 마피아임! 내가 조사했음!`,
                                `${targetName} 마피아 확실함! 투표각!`,
                                `조사결과 나왔음! ${targetName} 마피아임!`,
                                `${targetName} 진짜 마피아라고! 믿어줘 제발!`,
                                `내가 경찰임, ${targetName} 마피아 맞음!`,
                                `실화냐? ${targetName} 마피아 떴음!`,
                                `${targetName} 마피아 확정! 개확실함!`
                            ];
                            return mafiaAnnouncements[Math.floor(Math.random() * mafiaAnnouncements.length)];
                        } else {
                            console.log(`[경찰 결과 발표] ${bot.name}: ${targetName} 무고 발표`);
                            const innocentAnnouncements = [
                                `${targetName} 시민임, 조사해봤음`,
                                `${targetName} 마피아 아님 확실해`,
                                `조사결과 ${targetName} 무고함`,
                                `${targetName} 믿어도 됨, 시민임`,
                                `${targetName} 시민 확정임 ㅇㅇ`,
                                `${targetName} 깨끗함 믿어줘`
                            ];
                            return innocentAnnouncements[Math.floor(Math.random() * innocentAnnouncements.length)];
                        }
                    }
                }
            } else {
                console.log(`[경찰 메시지] ${bot.name}: 조사 기록 없음`);
            }
        }
        
        // 경찰 역할 주장 (조사 결과가 없는 경우)
        if (phase === 'discussion' && Math.random() < 0.3) {
            const roleClaimMessages = [
                "나 경찰임. 조사결과 알려줄게",
                "내가 경찰이니까 믿어줘 제발",
                "경찰인 나만 믿어 진짜",
                "나 진짜 경찰임, 조사했음",
                "경찰이라고! 믿어달라고!"
            ];
            messages.push(roleClaimMessages[Math.floor(Math.random() * roleClaimMessages.length)]);
        }
        
        // 추리 결과 공유
        if (analysis && analysis.playerProfiles) {
            const mafiaLikelyPlayers = Array.from(analysis.playerProfiles.values())
                .filter(p => p.mafiaLikelihood > 70 && p.playerId !== bot.id)
                .sort((a, b) => b.mafiaLikelihood - a.mafiaLikelihood);
            
            if (mafiaLikelyPlayers.length > 0) {
                const suspect = mafiaLikelyPlayers[0];
                messages.push(`${suspect.playerName} 마피아일 가능성 개높음`);
                messages.push(`${suspect.playerName} 진짜 개수상함`);
            }
        }
        
        // 수사 전략 공유
        if (phase === 'discussion') {
            messages.push("체계적으로 수사할거임");
            messages.push("모든 증거 종합해서 판단하자고");
            messages.push("의심스러운 사람 있으면 말해줘 제발");
            messages.push("다음에 누구 조사할까? 의견줘");
        } else if (phase === 'voting') {
            messages.push("증거 보고 투표하자");
            messages.push("확실한 마피아한테 투표해야함");
            messages.push("잘못 투표하면 ㅈㄴ 큰일남");
        }
        
        return messages.length > 0 ? messages[Math.floor(Math.random() * messages.length)] : "계속 수사할게";
    }

    // 무당 봇 메시지 생성 (자연스럽고 상호작용적인 반말)
    createShamanMessage(room, bot, phase, context, suspiciousPlayers, trustedPlayers) {
        const analysis = this.performAdvancedDeduction(room, bot);
        
        if (analysis && analysis.playerProfiles.size > 0) {
            return this.createSmartShamanMessage(room, bot, phase, context, analysis);
        }
        
        // 기존 로직 fallback (상호작용적이고 자연스러운 반말)
        const messages = [
            "야 나 무당인데 죽은 사람 역할 알 수 있어",
            "죽은 놈들 조사해서 알려줄게",
            "내가 무당이니까 내 말 믿어봐",
            "죽은 사람들 역할 확인했는데 중요해",
            "다들 들어봐, 내가 조사한 결과야",
            "무당 능력으로 확인한 거 말해줄게",
            "이거 진짜 중요한 정보인데 들어볼래?",
            "죽은 사람 역할 봤는데 이상해"
        ];
        
        return messages[Math.floor(Math.random() * messages.length)];
    }

    // 스마트 무당 메시지 생성 - 영혼 조사 결과 발표
    createSmartShamanMessage(room, bot, phase, context, analysis) {
        const messages = [];
        const history = this.gameHistory.get(room.code);
        
        // 🔮 영혼 조사 결과 발표 (아침/토론 시간에 우선적으로)
        if ((phase === 'discussion' || phase === 'morning') && history) {
            let spiritInvestigationsToCheck = [];
            
            // 1. 먼저 현재 라운드(currentRound)에서 영혼 조사 결과 확인
            if (history.currentRound && history.currentRound.spiritInvestigations && history.currentRound.spiritInvestigations.length > 0) {
                spiritInvestigationsToCheck = history.currentRound.spiritInvestigations;
                console.log(`[무당 메시지] ${bot.name}: 현재 라운드 ${room.round} 영혼 조사 결과 확인 중...`);
            }
            // 2. 현재 라운드에 없으면 마지막 완료된 라운드에서 확인
            else if (history.rounds.length > 0) {
                const lastRound = history.rounds[history.rounds.length - 1];
                if (lastRound.spiritInvestigations && lastRound.spiritInvestigations.length > 0) {
                    spiritInvestigationsToCheck = lastRound.spiritInvestigations;
                    console.log(`[무당 메시지] ${bot.name}: 라운드 ${lastRound.round} 영혼 조사 결과 확인 중...`);
                }
            }
            
            // 영혼 조사 결과가 있으면 발표
            if (spiritInvestigationsToCheck.length > 0) {
                for (const investigation of spiritInvestigationsToCheck) {
                    console.log(`[무당 메시지] 영혼 조사 기록: ${investigation.investigator} → ${investigation.target} (${investigation.targetRole})`);
                    
                    if (investigation.investigator === bot.id) {
                        const targetName = this.getPlayerName(investigation.target, room);
                        const roleDisplayName = this.getRoleDisplayName(investigation.targetRole);
                        
                        console.log(`[무당 결과 발표] ${bot.name}: ${targetName}의 역할 ${roleDisplayName} 발표`);
                        
                        const spiritAnnouncements = [
                            `야 중요한 정보! ${targetName}은 ${roleDisplayName}이었어!`,
                            `${targetName} 조사해봤는데 ${roleDisplayName}이었다고`,
                            `내가 확인했어. ${targetName}은 ${roleDisplayName}이 맞아!`,
                            `다들 들어봐! ${targetName} 진짜 역할은 ${roleDisplayName}!`,
                            `무당으로서 확실히 말하는데 ${targetName}는 ${roleDisplayName}이었어`,
                            `조사 결과 나왔어! ${targetName} = ${roleDisplayName}임!`
                        ];
                        return spiritAnnouncements[Math.floor(Math.random() * spiritAnnouncements.length)];
                    }
                }
            } else {
                console.log(`[무당 메시지] ${bot.name}: 영혼 조사 기록 없음`);
            }
        }
        
        // 무당 역할 주장 (영혼 조사 결과가 없는 경우)
        if (phase === 'discussion' && Math.random() < 0.3) {
            const roleClaimMessages = [
                "야 나 무당인데 죽은 놈들 역할 다 볼 수 있어",
                "내가 무당이니까 내 말 좀 믿어봐",
                "무당 능력 있다고 진짜로",
                "나 무당이야, 죽은 사람들 조사 가능해",
                "무당으로서 말하는 건데 이거 중요함",
                "내가 무당이니까 내 정보 들어봐"
            ];
            messages.push(roleClaimMessages[Math.floor(Math.random() * roleClaimMessages.length)]);
        }
        
        // 죽은 사람들에 대한 언급
        if (phase === 'discussion') {
            messages.push("죽은 사람들 역할 보고 판단해야지");
            messages.push("내가 조사한 정보들 참고해봐");
            messages.push("무당 정보 활용하면 마피아 찾을 수 있어");
            messages.push("다음에 누가 죽으면 또 조사해줄게");
            messages.push("죽은 놈들 역할 더 알아보자");
            messages.push("이미 죽은 사람들 역할이 중요한 단서야");
        } else if (phase === 'voting') {
            messages.push("내가 알려준 정보 보고 투표해");
            messages.push("죽은 사람들 역할 참고해서 투표하자");
            messages.push("무당 정보 믿고 투표해봐");
        }
        
        return messages.length > 0 ? messages[Math.floor(Math.random() * messages.length)] : "죽은 사람들 더 조사해볼게";
    }

    // 역할 표시명 반환 (무당 봇용)
    getRoleDisplayName(role) {
        const roleNames = {
            'mafia': '마피아',
            'doctor': '의사',
            'police': '경찰',
            'wizard': '마법사',
            'joker': '조커',
            'shaman': '무당',
            'politician': '정치인'
        };
        return roleNames[role] || role;
    }

    // 의사 봇 메시지 생성 (디시인사이드 말투) - 🆕 대폭 개선된 다양성 시스템
    createDoctorMessage(room, bot, phase, context, suspiciousPlayers, trustedPlayers) {
        // 🆕 감정 상태 업데이트
        const alivePlayers = this.getAlivePlayers(room);
        this.updateEmotionalState(bot.id, {
            round: room.round,
            alivePlayers: alivePlayers.length,
            suspiciousPlayers: suspiciousPlayers,
            recentDeaths: context.nightResults ? 1 : 0
        });
        
        const emotionalState = this.emotionalStates.get(bot.id);
        
        // 🆕 대폭 확장된 의사 메시지 풀 (감정 상태별)
        let baseMessages = [];
        
        // 기본 의사 업무 메시지 (평상시)
        if (!emotionalState || emotionalState.tension < 0.7) {
            baseMessages = [
                "모두 안전했으면 좋겠음 진짜",
                "마피아 빨리 찾아서 평화롭게 하자",
                "더 이상 희생자 없었으면 해 제발",
                "누가 위험할까? 걱정됨",
                "다들 조심해야함 ㅇㅇ",
                "마피아가 누구 노릴까? 무서워",
                "의사로서 모두 지켜야지",
                "생명 구하는게 내 사명임",
                "치료받을 사람 있으면 말해",
                "의학적으로 분석해보면",
                "환자들 안전이 최우선",
                "히포크라테스 선서 지킬거야",
                "의사 가운 입고 왔음 ㅋㅋ",
                "병원에서 배운대로 할게",
                "생명은 소중한거야",
                "응급실 경험 살려서 판단함",
                "의료진으로서 책임감 느껴",
                "다치거나 위험한 사람 치료할게",
                "건강관리 잘 하시고",
                "의학 지식으로 도움될까?",
                "수술용 메스 들고있음 ㅋㅋ",
                "청진기로 심장소리 들어봤는데",
                "의료진은 중립이야",
                "환자 차별 안하는게 원칙",
                "의료윤리 지키면서 할게",
                "응급처치 필요한 사람?",
                "진료차트 작성하고있어",
                "의학박사 학위 믿어봐",
                "병원 근무경력 10년임",
                "의료사고 절대 안내겠어",
                "환자 안전이 최우선이야",
                "치료비는 나중에 계산하고",
                "의료보험 처리해줄게",
                "약 처방전 써줄까?",
                "진단서 필요하면 말해",
                "의료진으로서 중립 지킬게",
                "생명윤리 위반 못해"
            ];
        } else {
            // 고긴장 상태 메시지 (위험한 상황)
            baseMessages = [
                "ㅅㅂ 이제 정말 위험해!! 치료 제대로 해야함!!",
                "의사로서 마지막까지 생명 구할거야!!",
                "응급상황이야!! 빨리 치료해야해!!",
                "이번에 못 살리면 다 죽어!!",
                "의료진 총력전이다!! 누구든 살려내겠어!!",
                "생명 구하는게 우선이야!! 마피아는 나중에!!",
                "응급실 모드 켠다!! 모두 구해낼거야!!",
                "의사 생명걸고 치료할게!!",
                "히포크라테스가 살아있다면 이렇게 했을거야!!",
                "의료진은 절대 포기 안해!!",
                "수술실 확보하고 응급처치 시작!!",
                "생명 살리는게 최우선이야!!",
                "의료진으로서 마지막 책임진다!!",
                "심폐소생술이라도 할거야!!",
                "의료사고 절대 안내!! 모두 살리겠어!!",
                "응급의학과 전문의 실력 보여줄게!!",
                "생명은 하나뿐이야!! 포기 못해!!",
                "의료진 명예걸고 구해낼거야!!",
                "마지막까지 의료윤리 지킬게!!",
                "죽음 앞에서도 의사 역할 할거야!!"
            ];
        }
        
        // 🆕 밤 결과별 특별 메시지
        if (phase === 'discussion' && context.nightResults) {
            if (context.nightResults.killed) {
                const killedName = this.getPlayerNameById(context.nightResults.killed, room);
                const sorrowMessages = [
                    `${killedName} 살리지 못해서 죄송함... ㅠㅠ`,
                    `어젯밤 치료했는데 못 살렸음 ㅅㅂ`,
                    `아니 진짜 미안... 살릴 수 없었음`,
                    `${killedName} 의료진으로서 죄송해`,
                    `치료 시도했는데 실패했어...`,
                    `의사로서 너무 무력감 느껴`,
                    `${killedName} 구하지 못한게 한이야`,
                    `응급처치 했는데 소용없었어`,
                    `의학의 한계를 느꼈어...`,
                    `${killedName} 가족분들께 죄송함`,
                    `더 빨리 도착했으면... 후회돼`,
                    `의료진으로서 책임감 느껴`
                ];
                baseMessages.push(...sorrowMessages);
            } else if (context.nightResults.saved) {
                // 의사가 성공적으로 치료한 경우 (직접적으로 말하지 않음)
                const reliefMessages = [
                    "다행히 어젯밤엔 아무도 안 죽었네 ㅇㅇ",
                    "좋은 일임, 모두 살았어",
                    "누군가 살렸나봄, 다행이다",
                    "의료진이 잘 했나봐",
                    "응급처치 성공한듯 해",
                    "생명이 구해져서 다행이야",
                    "의료진의 승리다!",
                    "히포크라테스 선서가 지켜졌네",
                    "응급의학의 힘이야",
                    "치료 성공한것 같아서 기뻐"
                ];
                baseMessages.push(...reliefMessages);
            } else {
                // 아무 일 없었을 때
                baseMessages.push(
                    "평화로운 밤이었네",
                    "다행히 환자 없었어",
                    "응급실이 조용했음",
                    "의료진도 쉴 수 있었어",
                    "오늘은 치료할 일 없었네"
                );
            }
        }
        
        // 🆕 역할 의심받을 때 방어 메시지
        if (emotionalState && emotionalState.anger > 0.5) {
            baseMessages.push(
                "야 나 진짜 의사야!!",
                "의사 면허증 보여줄까??",
                "의대 졸업했다고!! 왜 안믿어??",
                "스크럽 입고있는거 안보임??",
                "청진기 들고있는데도 의심함??",
                "히포크라테스 선서했다고!!",
                "의료진 의심하지마!!",
                "병원에서 파견온거야!!",
                "의료보험 번호 알려줄까??",
                "진짜 의사인데 왜 몰아가??",
                "의료진한테 왜 이래??",
                "환자 살리려는 사람 의심함??"
            );
        }
        
        // 🆕 보호 대상에 대한 메시지 (동적 생성)
        const filteredTrustedPlayers = trustedPlayers.filter(p => p.player.id !== bot.id);
        if (filteredTrustedPlayers.length > 0) {
            const trusted = filteredTrustedPlayers[0];
            if (trusted && trusted.player && trusted.player.id) {
                const trustedName = this.getPlayerNameById(trusted.player.id, room);
                const protectionMessages = [
                    `${trustedName} 보호해야겠음`,
                    `${trustedName} 개걱정됨`,
                    `${trustedName} 안전했으면 좋겠는뎅`,
                    `${trustedName} 치료 우선순위야`,
                    `${trustedName} 의료진이 지켜줄게`,
                    `${trustedName} 건강상태 체크해봐야겠어`,
                    `${trustedName} 응급처치 준비해둘게`,
                    `${trustedName} 의료보험 적용해줄게`,
                    `${trustedName} 약 처방해줄까?`,
                    `${trustedName} 정기검진 받아야해`,
                    `${trustedName} 병원 VIP로 등록할게`,
                    `${trustedName} 의료진이 책임진다`
                ];
                baseMessages.push(...protectionMessages);
            }
        }
        
        // 🆕 의심스러운 플레이어에 대한 의료진 관점 메시지
        const filteredSuspiciousPlayers = suspiciousPlayers.filter(p => p.player.id !== bot.id);
        const chattedSuspiciousPlayers = this.filterPlayersWhoChatted(room.code, filteredSuspiciousPlayers);
        if (chattedSuspiciousPlayers.length > 0) {
            const target = chattedSuspiciousPlayers[0];
            const medicalSuspicionMessages = [
                `${target.player.name} 심박수가 이상해`,
                `${target.player.name} 스트레스 수치 높아보임`,
                `${target.player.name} 혈압 측정해봐야겠네`,
                `${target.player.name} 얼굴색이 안좋아`,
                `${target.player.name} 건강검진 받아봐야할듯`,
                `${target.player.name} 정신상태 체크 필요`,
                `${target.player.name} 의학적으로 수상함`,
                `${target.player.name} 진료기록 확인해볼게`,
                `${target.player.name} CT 촬영 권함`,
                `${target.player.name} 혈액검사 결과 궁금해`
            ];
            baseMessages.push(...medicalSuspicionMessages);
        }
        
        // 🆕 페이즈별 메시지 추가
        if (phase === 'voting') {
            baseMessages.push(
                "신중하게 투표해야함 ㅇㅇ",
                "무고한 사람 투표하면 안됨",
                "확실한 증거 있을 때 투표하자고",
                "잘못 투표하면 ㅈㄴ 큰일남",
                "정말 마피아인지 확실함?",
                "의료진으로서 신중하게 판단",
                "생명 관련된 투표야 조심해",
                "히포크라테스 선서 생각해봐",
                "의료윤리적으로 고민되네",
                "환자 안전 고려해서 투표",
                "의료진은 생명존중이 우선",
                "진단 정확히 하고 투표하자",
                "오진하면 안되는것처럼 신중히",
                "의료진의 책임감으로 투표"
            );
        } else if (phase === 'discussion') {
            baseMessages.push(
                "의료진 관점에서 분석해볼게",
                "건강상태로 판단해보면",
                "의학지식 활용해서 추리하자",
                "응급의학과 경험으로는",
                "병원에서 본 사람들 특징으로는",
                "의료진이니까 객관적으로 봄",
                "진료차트 작성하듯 정리해보자",
                "의학적 소견 말해줄까?",
                "건강검진 결과 공유할게",
                "의료진으로서 조언해줄게",
                "히포크라테스 선서 기준으로",
                "응급실 경험상 말하는건데"
            );
        }
        
        // 🆕 다양성 시스템 적용한 메시지 선택
        const selectedMessage = this.selectDiverseMessage(bot.id, baseMessages);
        
        // 사용된 메시지 기록
        if (selectedMessage) {
            this.recordUsedMessage(bot.id, selectedMessage);
        }
        
        return selectedMessage || "의료진으로서 최선을 다하겠습니다...";
    }

    // 마피아 봇 메시지 생성 (일반 채팅 - 기만과 속임수, 자연스러운 반말)
    createMafiaMessage(room, bot, phase, context, suspiciousPlayers, trustedPlayers) {
        // 🎭 가짜 경찰 봇인 경우 거짓 조사 결과 발표 (최우선 - 분석 여부와 관계없이)
        if (this.isFakePoliceBot(room.code, bot.id)) {
            console.log(`[가짜 경찰 채팅 기본] ${bot.name}이 가짜 경찰 연기 중...`);
            
            // 토론이나 아침 시간에만 조사 결과 발표
            if (phase === 'discussion' || phase === 'morning') {
                const unnouncedInvestigations = this.getUnnouncedFakeInvestigations(room.code, bot.id);
                
                if (unnouncedInvestigations.length > 0) {
                    const fakeInv = unnouncedInvestigations[0]; // 가장 최근 조사 결과
                    
                    // 발표됨으로 표시
                    this.markFakeInvestigationAsAnnounced(room.code, bot.id, fakeInv.target);
                    
                    if (fakeInv.result === 'mafia') {
                        // 무고한 사람을 마피아로 거짓 발표
                        const fakeMafiaAnnouncements = [
                            `야! ${fakeInv.targetName} 마피아임! 내가 조사했음!`,
                            `${fakeInv.targetName} 마피아 확실함! 투표각!`,
                            `조사결과 나왔음! ${fakeInv.targetName} 마피아임!`,
                            `${fakeInv.targetName} 진짜 마피아라고! 믿어줘 제발!`,
                            `내가 경찰임, ${fakeInv.targetName} 마피아 맞음!`,
                            `${fakeInv.targetName} 조사했는데 마피아였음!`,
                            `경찰인 내가 확인했음, ${fakeInv.targetName} 마피아임!`,
                            `실화냐? ${fakeInv.targetName} 마피아 떴음 ㅋㅋ`
                        ];
                        console.log(`[가짜 경찰 발표 기본] ${bot.name}: ${fakeInv.targetName}을 마피아로 거짓 발표`);
                        return fakeMafiaAnnouncements[Math.floor(Math.random() * fakeMafiaAnnouncements.length)];
                    } else {
                        // 마피아 동료를 시민으로 거짓 발표
                        const fakeInnocentAnnouncements = [
                            `${fakeInv.targetName} 시민임, 조사해봤음`,
                            `${fakeInv.targetName} 마피아 아님 확실해`,
                            `조사결과 ${fakeInv.targetName} 무고함`,
                            `${fakeInv.targetName} 믿어도 됨, 시민임`,
                            `${fakeInv.targetName} 시민 확정임 ㅇㅇ`,
                            `내가 조사했는데 ${fakeInv.targetName} 깨끗함`,
                            `경찰인 내가 보증함, ${fakeInv.targetName} 시민 맞음`
                        ];
                        console.log(`[가짜 경찰 발표 기본] ${bot.name}: ${fakeInv.targetName}을 시민으로 거짓 발표`);
                        return fakeInnocentAnnouncements[Math.floor(Math.random() * fakeInnocentAnnouncements.length)];
                    }
                }
                
                // 조사 결과가 없으면 경찰 역할 주장
                if (Math.random() < 0.3) { // 30% 확률
                    const policeClaimMessages = [
                        "나 경찰이야. 조사 결과 알려줄게",
                        "내가 경찰이니까 믿어줘",
                        "경찰인 나만 믿어",
                        "나 진짜 경찰이야, 조사했어",
                        "경찰로서 말하는데 신중하게 해야 해",
                        "내가 경찰이니까 내 말 들어봐"
                    ];
                    console.log(`[가짜 경찰 역할 주장 기본] ${bot.name}: 경찰 역할 주장`);
                    return policeClaimMessages[Math.floor(Math.random() * policeClaimMessages.length)];
                }
            }
        }

        const analysis = this.performAdvancedDeduction(room, bot);
        
        if (analysis && analysis.playerProfiles.size > 0) {
            return this.createSmartMafiaMessage(room, bot, phase, context, analysis);
        }
        
        // 🆕 감정 상태 업데이트
        const alivePlayers = this.getAlivePlayers(room);
        this.updateEmotionalState(bot.id, {
            round: room.round,
            alivePlayers: alivePlayers.length,
            suspiciousPlayers: suspiciousPlayers,
            recentDeaths: context.nightResults ? 1 : 0
        });
        
        const emotionalState = this.emotionalStates.get(bot.id);
        
        // 🆕 대폭 확장된 마피아 메시지 풀 (교활한 시민 연기)
        let baseMessages = [];
        
        // 기본 시민 연기 메시지 (평상시)
        if (!emotionalState || emotionalState.tension < 0.7) {
            baseMessages = [
                "마피아 찾아야 해",
                "누가 의심스러워?",
                "증거가 부족한데?",
                "신중하게 생각해야지",
                "진짜 마피아 누구야?",
                "다들 어떻게 생각해?",
                "확실한 증거 없으면 위험해",
                "시민끼리 싸우면 안 되는데...",
                "마피아가 웃고 있을 거야",
                "나도 시민이니까 같이 찾자",
                "정말 어려운 게임이네",
                "마피아가 너무 잘 숨었어",
                "시민팀이 이겨야지",
                "다들 힘내서 찾아보자",
                "차분하게 분석해봐야겠어",
                "성급하게 결정하면 안돼",
                "논리적으로 접근해보자",
                "모든 가능성 고려해야해",
                "실수하면 안되니까 신중히",
                "마피아가 교묘하게 숨어있을거야",
                "시민들 의견 들어보고 싶어",
                "협력해서 마피아 찾자",
                "정보 공유가 중요할듯",
                "의심만으로는 부족해",
                "확실한 근거가 있어야지",
                "추측만으로 판단하면 위험해",
                "마피아 입장에서 생각해보면",
                "시민이라면 당당해야지",
                "거짓말할 이유가 없잖아",
                "진실만 말하면 되는거 아냐?",
                "시민끼리 믿고 가자",
                "마피아는 분명 실수할거야",
                "시간이 지나면 티날거야",
                "인내심 갖고 기다려보자",
                "마피아도 사람인데 완벽하진 않겠지",
                "작은 단서라도 놓치면 안돼",
                "관찰력이 중요한 게임이네",
                "심리전이 흥미로워"
            ];
        } else {
            // 고긴장 상태 메시지 (위험한 상황에서 더 교활하게)
            baseMessages = [
                "이제 정말 중요한 순간이야!!",
                "마피아 놈들 더이상 숨지 못해!!",
                "시민팀 힘내!! 거의 다 왔어!!",
                "이번에 실수하면 정말 큰일나!!",
                "마피아가 필사적으로 숨으려 할거야!!",
                "시민들 속지말고 잘 판단해줘!!",
                "지금까지의 정보 종합해보자!!",
                "마피아 새끼들 이제 끝이야!!",
                "시민팀 승리까지 조금 남았어!!",
                "마지막까지 포기하지 말자!!",
                "진실은 반드시 밝혀질거야!!",
                "정의가 승리할거야!!",
                "마피아들 떨고 있을거야!!",
                "시민의 힘을 보여주자!!",
                "거짓은 오래가지 못해!!",
                "진실이 이기는 게임이야!!",
                "마피아 놈들 관짝 준비해!!",
                "시민팀 단결하면 이길 수 있어!!",
                "마지막 스퍼트 달리자!!",
                "승리는 우리 것이야!!"
            ];
        }
        
        // 🆕 교활한 의심 전환 메시지 (다른 시민을 의심하게 만들기)
        const filteredSuspiciousPlayers = suspiciousPlayers.filter(p => p.player.id !== bot.id);
        const chattedSuspiciousPlayers = this.filterPlayersWhoChatted(room.code, filteredSuspiciousPlayers);
        if (chattedSuspiciousPlayers.length > 0) {
            const target = chattedSuspiciousPlayers[0];
            
            // 🔧 실제 모순 발언이 있는지 확인  
            const targetContradictions = this.checkPlayerContradictions(room.code, target.player.id);
            
            const suspicionMessages = [
                `${target.player.name} 좀 의심스럽네`,
                `${target.player.name} 어떻게 생각해?`,
                `${target.player.name} 행동이 이상하지 않아?`,
                `${target.player.name} 뭔가 수상한 느낌이야`,
                `${target.player.name} 말투가 어색해`,
                `${target.player.name} 너무 조용하지 않나?`,
                `${target.player.name} 반응이 늦는것 같은데`,
                `${target.player.name} 시민 맞나 의심됨`,
                `${target.player.name} 뭔가 숨기는게 있는듯`,
                `${target.player.name} 눈빛이 좀...`,
                `${target.player.name} 대답을 회피하는것 같아`,
                `${target.player.name} 솔직하지 않은느낌`,
                `${target.player.name} 일관성이 없어보여`,
                `${target.player.name} 변명이 너무 많아`,
                `${target.player.name} 시민다운 느낌이 안나`
            ];
            
            // 실제 모순이 있을 때만 "말이 앞뒤 안 맞는다" 언급
            if (targetContradictions.length > 0) {
                suspicionMessages.push(`${target.player.name} 말이 앞뒤가 안 맞는 것 같은데`);
                console.log(`[모순 발언 감지] ${bot.name}: ${target.player.name}의 실제 모순 발견 - ${targetContradictions[0].description}`);
            }
            
            baseMessages.push(...suspicionMessages);
        }
        
        // 🆕 동료 마피아 보호 메시지 (은밀하게)
        const filteredTrustedPlayers = trustedPlayers.filter(p => p.player.id !== bot.id);
        const mafiaAllies = filteredTrustedPlayers.filter(p => p.player.role === 'mafia');
        if (mafiaAllies.length > 0) {
            const ally = mafiaAllies[0];
            const protectionMessages = [
                `${ally.player.name}는 믿을만해 보여`,
                `${ally.player.name} 시민 같은데`,
                `${ally.player.name} 말이 논리적이야`,
                `${ally.player.name} 진실한 것 같아`,
                `${ally.player.name} 의심할 이유 없어`,
                `${ally.player.name} 시민팀이 확실해`,
                `${ally.player.name} 같은편인것 같아`,
                `${ally.player.name} 너무 의심하지 말자`
            ];
            baseMessages.push(...protectionMessages);
        }
        
        // 🆕 분노 상태 메시지 (의심받을 때 교묘한 방어)
        if (emotionalState && emotionalState.anger > 0.5) {
            baseMessages.push(
                "왜 나를 의심하는거야??",
                "나도 시민인데 억울해",
                "증거도 없으면서 의심하지마",
                "시민끼리 싸우면 마피아만 좋잖아",
                "내가 마피아라는 근거라도 있어?",
                "그렇게 의심하면 게임 못해",
                "나는 처음부터 시민팀이었어",
                "마피아가 나 몰아가는거 아냐?",
                "시민들은 단결해야 한다고",
                "의심만 하지말고 증거 찾자",
                "내 입장에서도 억울하다고",
                "진짜 마피아는 따로 있을거야",
                "왜 하필 나만 의심하는거야?",
                "다른 사람들은 안의심함??",
                "너무 성급하게 판단하는것 같아"
            );
        }
        
        // 🆕 페이즈별 교활한 메시지 추가
        if (phase === 'voting') {
            baseMessages.push(
                "투표 신중하게 하자",
                "확실하지 않으면 투표 말자",
                "시민 죽이면 안되니까 조심해",
                "마피아한테만 투표하자",
                "근거 있는 투표가 중요해",
                "감정적으로 투표하면 안돼",
                "논리적 근거로 투표하자",
                "시민팀 단합이 중요해",
                "마피아 생각해보면서 투표",
                "실수하면 우리가 불리해져",
                "냉정하게 판단하고 투표",
                "마피아 입장 고려해서 투표"
            );
        } else if (phase === 'discussion') {
            baseMessages.push(
                "정보 공유해서 마피아 찾자",
                "다들 의견 말해줘",
                "시민답게 토론하자",
                "건설적인 의견 환영해",
                "추리 과정 공유하자",
                "시민팀 협력이 중요해",
                "마피아 관점에서 생각해봐",
                "논리적 추론 해보자",
                "모든 가능성 열어두자",
                "편견 없이 분석하자",
                "객관적으로 접근해보자",
                "시민 여러분 힘내요"
            );
        }
        
        // 🆕 다양성 시스템 적용한 메시지 선택
        const selectedMessage = this.selectDiverseMessage(bot.id, baseMessages);
        
        // 사용된 메시지 기록
        if (selectedMessage) {
            this.recordUsedMessage(bot.id, selectedMessage);
        }
        
        return selectedMessage || "시민으로서 마피아를 찾아야겠어...";
    }

    // 스마트 마피아 메시지 생성 (교묘한 자연스러운 반말)
    createSmartMafiaMessage(room, bot, phase, context, analysis) {
        const messages = [];
        
        // 🎭 가짜 경찰 봇인 경우 거짓 조사 결과 발표 (최우선)
        if (this.isFakePoliceBot(room.code, bot.id)) {
            console.log(`[가짜 경찰 채팅] ${bot.name}이 가짜 경찰 연기 중...`);
            
            // 토론이나 아침 시간에만 조사 결과 발표
            if (phase === 'discussion' || phase === 'morning') {
                const unnouncedInvestigations = this.getUnnouncedFakeInvestigations(room.code, bot.id);
                
                if (unnouncedInvestigations.length > 0) {
                    const fakeInv = unnouncedInvestigations[0]; // 가장 최근 조사 결과
                    
                    // 발표됨으로 표시
                    this.markFakeInvestigationAsAnnounced(room.code, bot.id, fakeInv.target);
                    
                    if (fakeInv.result === 'mafia') {
                        // 무고한 사람을 마피아로 거짓 발표
                        const fakeMafiaAnnouncements = [
                            `야! ${fakeInv.targetName} 마피아야! 내가 조사했어!`,
                            `${fakeInv.targetName} 마피아 확실해! 투표해!`,
                            `조사 결과 나왔어! ${fakeInv.targetName} 마피아야!`,
                            `${fakeInv.targetName} 진짜 마피아라고! 믿어줘!`,
                            `내가 경찰이야, ${fakeInv.targetName} 마피아 맞아!`,
                            `${fakeInv.targetName} 조사했는데 마피아였어!`,
                            `경찰인 내가 확인했어, ${fakeInv.targetName} 마피아야!`
                        ];
                        console.log(`[가짜 경찰 발표] ${bot.name}: ${fakeInv.targetName}을 마피아로 거짓 발표`);
                        return fakeMafiaAnnouncements[Math.floor(Math.random() * fakeMafiaAnnouncements.length)];
                    } else {
                        // 마피아 동료를 시민으로 거짓 발표
                        const fakeInnocentAnnouncements = [
                            `${fakeInv.targetName} 시민이야, 조사해봤어`,
                            `${fakeInv.targetName} 마피아 아니야 확실해`,
                            `조사 결과 ${fakeInv.targetName} 무고해`,
                            `${fakeInv.targetName} 믿어도 돼, 시민이야`,
                            `${fakeInv.targetName} 시민 확정이야`,
                            `내가 조사했는데 ${fakeInv.targetName} 깨끗해`,
                            `경찰인 내가 보증해, ${fakeInv.targetName} 시민 맞아`
                        ];
                        console.log(`[가짜 경찰 발표] ${bot.name}: ${fakeInv.targetName}을 시민으로 거짓 발표`);
                        return fakeInnocentAnnouncements[Math.floor(Math.random() * fakeInnocentAnnouncements.length)];
                    }
                }
                
                // 조사 결과가 없으면 경찰 역할 주장
                if (Math.random() < 0.4) { // 40% 확률
                    const policeClaimMessages = [
                        "나 경찰이야. 조사 결과 알려줄게",
                        "내가 경찰이니까 믿어줘",
                        "경찰인 나만 믿어",
                        "나 진짜 경찰이야, 조사했어",
                        "경찰로서 말하는데 신중하게 해야 해",
                        "내가 경찰이니까 내 말 들어봐"
                    ];
                    console.log(`[가짜 경찰 역할 주장] ${bot.name}: 경찰 역할 주장`);
                    return policeClaimMessages[Math.floor(Math.random() * policeClaimMessages.length)];
                }
            }
        }
        
        // 일반 마피아 연기 (기존 로직)
        
        // 무고한 시민을 의심하는 발언 (교묘하게) - 🚨 **수정**: 실제로 채팅한 플레이어만 대상
        const innocentTargets = Array.from(analysis.playerProfiles.values())
            .filter(p => p.suspectedRole !== 'mafia' && p.mafiaLikelihood < 30 && this.hasPlayerChatted(room.code, p.playerId))
            .sort((a, b) => b.trustLevel - a.trustLevel);
        
        if (innocentTargets.length > 0) {
            const target = innocentTargets[0];
            
            // 🔧 **수정**: 실제 모순 발언이 있는지 확인
            const targetContradictions = this.checkPlayerContradictions(room.code, target.playerId);
            
            messages.push(`${target.playerName} 좀 의심스럽지 않아?`);
            messages.push(`${target.playerName} 행동이 이상한데?`);
            messages.push(`${target.playerName} 뭔가 수상해`);
            
            // 실제 모순이 있을 때만 "말이 앞뒤 안 맞는다" 언급
            if (targetContradictions.length > 0) {
                messages.push(`${target.playerName} 말이 앞뒤가 안 맞는 것 같은데`);
                console.log(`[모순 발언 감지] ${bot.name}: ${target.playerName}의 실제 모순 발견 - ${targetContradictions[0].description}`);
            } else {
                messages.push(`${target.playerName} 뭔가 느낌이 안 좋아`);
            }
        }
        
        // 🔧 **수정**: 실제로 역할을 주장한 플레이어만 의심 (추론이 아닌 실제 주장 기반)
        const history = this.gameHistory.get(room.code);
        const actualRoleClaimants = [];
        
        if (history && history.playerStatements) {
            for (const [playerId, profile] of analysis.playerProfiles) {
                const statements = history.playerStatements.get(playerId);
                if (statements && statements.roleClaims && statements.roleClaims.length > 0) {
                    const hasSpecialRoleClaim = statements.roleClaims.some(claim => 
                        claim.role === 'police' || claim.role === 'doctor'
                    );
                    
                    if (hasSpecialRoleClaim) {
                        actualRoleClaimants.push({
                            profile: profile,
                            claimedRoles: statements.roleClaims.filter(claim => 
                                claim.role === 'police' || claim.role === 'doctor'
                            )
                        });
                    }
                }
            }
        }
        
        if (actualRoleClaimants.length > 0) {
            const target = actualRoleClaimants[0];
            const claimedRole = target.claimedRoles[0].role;
            const roleDisplayName = claimedRole === 'police' ? '경찰' : '의사';
            
            console.log(`[마피아 역할 주장 의심] ${bot.name}: ${target.profile.playerName}의 실제 ${roleDisplayName} 주장을 의심`);
            
            messages.push(`${target.profile.playerName} ${roleDisplayName} 주장이 좀... 의심스럽지 않아?`);
            messages.push(`진짜 ${target.profile.playerName} ${roleDisplayName} 맞을까?`);
            messages.push(`${target.profile.playerName} 증거가 좀 부족한 것 같은데`);
        }
        
        // 시민 진영 분열 유도 (교묘하게)
        messages.push("서로 의심하지 말고 협력해야지");
        messages.push("증거 없이 의심하면 안 되는데");
        messages.push("시민끼리 싸우면 마피아만 좋아해");
        messages.push("차분하게 생각해보자");
        
        // 정보 혼란 유도
        messages.push("정보가 부족해서 판단하기 어렵네");
        messages.push("뭔가 확실하지 않아");
        messages.push("누구 말을 믿어야 할지 모르겠어");
        messages.push("좀 더 신중하게 해야겠어");
        
        return messages[Math.floor(Math.random() * messages.length)];
    }

    // 보조 함수들
    getPoliceResultsFromAnalysis(analysis) {
        const results = [];
        // 분석에서 경찰 조사 결과 추출
        // 실제 구현에서는 히스토리에서 경찰 조사 결과를 가져와야 함
        return results;
    }

    generateVotingInsights(analysis, currentBotId = null, room = null) {
        // 투표 패턴에서 인사이트 생성 (자연스러운 반말, 자기 자신 제외)
        const insights = [];
        
        if (analysis && analysis.votingAnalysis && analysis.votingAnalysis.size > 0) {
            for (const [playerId, pattern] of analysis.votingAnalysis) {
                // 🚨 자기 자신에 대한 분석은 말하지 않음
                if (currentBotId && playerId === currentBotId) {
                    continue;
                }
                
                if (pattern.votedForCitizen > pattern.votedForMafia && pattern.totalVotes > 1) {
                    // room이 있으면 room에서 찾고, 없으면 analysis에서 찾기
                    const playerName = room ? this.getPlayerName(playerId, room) : this.getPlayerNameById(playerId, analysis);
                    
                    // unknown이면 메시지 생성 안 함
                    if (playerName === 'unknown') continue;
                    
                    const votingInsights = [
                        `${playerName} 시민들한테 투표 많이 했네`,
                        `${playerName} 마피아보다 시민 투표 더 많이 해`,
                        `${playerName} 투표 패턴이 좀 이상한데?`,
                        `${playerName} 왜 시민들만 골라서 투표하지?`
                    ];
                    insights.push(votingInsights[Math.floor(Math.random() * votingInsights.length)]);
                }
            }
        }
        
        return insights.length > 0 ? insights[0] : null;
    }

    generateSurvivalInsights(analysis, currentBotId = null, room = null) {
        // 생존 패턴에서 인사이트 생성 (자연스러운 반말, 자기 자신 제외)
        const insights = [];
        
        if (analysis && analysis.survivalAnalysis && analysis.survivalAnalysis.size > 0) {
            for (const [playerId, pattern] of analysis.survivalAnalysis) {
                // 🚨 자기 자신에 대한 분석은 말하지 않음
                if (currentBotId && playerId === currentBotId) {
                    continue;
                }
                
                if (pattern.nightsSurvived > 2 && pattern.timesAttacked === 0) {
                    // room이 있으면 room에서 찾고, 없으면 analysis에서 찾기
                    const playerName = room ? this.getPlayerName(playerId, room) : this.getPlayerNameById(playerId, analysis);
                    
                    // unknown이면 메시지 생성 안 함
                    if (playerName === 'unknown') continue;
                    
                    const survivalInsights = [
                        `${playerName} 계속 살아남는 게 수상한데?`,
                        `${playerName} 왜 마피아가 안 죽이지?`,
                        `${playerName} 너무 오래 살아있어`,
                        `${playerName} 마피아가 안 건드리는 것 같은데?`,
                        `${playerName} 생존률이 좀 이상해`
                    ];
                    insights.push(survivalInsights[Math.floor(Math.random() * survivalInsights.length)]);
                }
            }
        }
        
        return insights.length > 0 ? insights[0] : null;
    }

    getPlayerName(playerId, room) {
        if (!room || !room.players) {
            return 'unknown';
        }
        const player = room.players.get(playerId) || room.bots.get(playerId);
        return player ? player.name : 'unknown';
    }

    getPlayerNameById(playerId, roomOrAnalysis) {
        // roomOrAnalysis가 analysis 객체인 경우 (새로운 스마트 시스템)
        if (roomOrAnalysis && roomOrAnalysis.playerProfiles) {
            const profile = roomOrAnalysis.playerProfiles.get(playerId);
            return profile ? profile.playerName : 'unknown';
        }
        
        // roomOrAnalysis가 room 객체인 경우 (기존 시스템)
        if (roomOrAnalysis && roomOrAnalysis.players) {
            const player = roomOrAnalysis.players.get(playerId) || roomOrAnalysis.bots.get(playerId);
            return player ? player.name : 'unknown';
        }
        
        return 'unknown';
    }

    // 마피아 전용 채팅 메시지 생성
    createMafiaChatMessage(room, mafiaBot, context) {
        if (!room || !mafiaBot || !context) {
            return null;
        }
        
        const messages = [];
        const alivePlayers = this.getAlivePlayers(room);
        if (!alivePlayers || alivePlayers.length === 0) {
            return null;
        }
        
        const mafiaMembers = alivePlayers.filter(p => p.role === 'mafia');
        const innocentPlayers = alivePlayers.filter(p => p.role !== 'mafia');

        if (context.planning) {
            // 밤 행동 계획 (더 자연스러운 반말)
            if (innocentPlayers.length > 0) {
                const target = innocentPlayers[Math.floor(Math.random() * innocentPlayers.length)];
                const targetName = this.getPlayerName(target.id, room);
                messages.push(`${targetName} 죽이는 게 어때?`);
                messages.push(`${targetName} 위험해 보이는데, 제거하자`);
                messages.push(`${targetName} 타겟으로 하면 어떨까?`);
                messages.push(`${targetName} 없애야겠어`);
                messages.push(`${targetName} 얘 좀 위험한 것 같은데`);
            }
            
            messages.push('누구 죽일까?');
            messages.push('경찰이 누군지 알아내야 해');
            messages.push('의사가 누구 보호할까?');
            messages.push('다음 타겟 정해야지');
            messages.push('누가 제일 위험해?');
            
        } else if (context.discussion) {
            // 토론 전략 (더 자연스러운 반말)
            messages.push('시민인 척 잘 해야 해');
            messages.push('누구 의심할까?');
            messages.push('경찰 척 하는 놈 조심해');
            messages.push('투표에서 누구 밀어낼까?');
            messages.push('들키면 안 되니까 조심하자');
            messages.push('자연스럽게 행동해야 해');
            messages.push('너무 티 내지 마');
            
        } else {
            // 일반적인 협력 메시지 (더 자연스러운 반말)
            messages.push('팀워크가 중요해');
            messages.push('시민들 속이기 쉽지 않네');
            messages.push('우리가 이길 수 있어!');
            messages.push('잘 하고 있어');
            messages.push('이번엔 꼭 이기자');
        }

        return messages.length > 0 ? messages[Math.floor(Math.random() * messages.length)] : null;
    }

    // 중복 함수 제거됨 - 위에 정의된 getPlayerNameById 함수 사용

    // 페이즈별 봇 채팅 시작 - 개선됨 (경찰 vs 가짜경찰 발표 순서 랜덤화)
    triggerBotChats(room, phase, context = {}) {
        const aliveBots = Array.from(room.bots.values()).filter(bot => bot.alive);
        
        // 🎲 토론 시간에 경찰과 가짜경찰의 조사결과 발표 순서를 랜덤화
        if (phase === 'discussion') {
            // 진짜 경찰 봇들 찾기
            const policeBots = aliveBots.filter(bot => bot.role === 'police');
            
            // 가짜 경찰 봇들 찾기 (마피아 중에서 경찰 연기하는 봇)
            const fakePoliceBots = aliveBots.filter(bot => 
                bot.role === 'mafia' && this.isFakePoliceBot(room.code, bot.id)
            );
            
            // 경찰 관련 봇들 (진짜 + 가짜) 모두 수집
            const allPoliceBots = [...policeBots, ...fakePoliceBots];
            
            console.log(`[경찰 발표 순서] 진짜 경찰: ${policeBots.length}명, 가짜 경찰: ${fakePoliceBots.length}명`);
            
            if (allPoliceBots.length > 0) {
                // 🎲 경찰 관련 봇들의 발표 순서를 완전히 랜덤화
                const shuffledPoliceBots = allPoliceBots.sort(() => Math.random() - 0.5);
                
                shuffledPoliceBots.forEach((policeBot, index) => {
                    // 1-4초 사이에 랜덤하게 발표 (기존보다 범위 확장)
                    const delay = 1000 + (Math.random() * 3000) + (index * 500);
                    
                    setTimeout(() => {
                        if (room.gameState === phase && policeBot.alive) {
                            const botType = policeBot.role === 'police' ? '진짜 경찰' : '가짜 경찰';
                            console.log(`[랜덤 경찰 발표] ${policeBot.name} (${botType}): 조사 결과 발표 시도`);
                            this.generateBotChat(room, policeBot, phase, context);
                        }
                    }, delay);
                });
            }
            
            // 경찰 관련이 아닌 나머지 봇들
            const nonPoliceBots = aliveBots.filter(bot => 
                bot.role !== 'police' && 
                !(bot.role === 'mafia' && this.isFakePoliceBot(room.code, bot.id))
            );
            const shuffledBots = nonPoliceBots.sort(() => Math.random() - 0.5);
            
            shuffledBots.forEach((bot, index) => {
                // 경찰들의 발표 후에 채팅 (5-15초 사이)
                const baseDelay = 5000;
                const delay = baseDelay + (Math.random() * 10000);
                
                setTimeout(() => {
                    if (room.gameState === phase && bot.alive) {
                        this.generateBotChat(room, bot, phase, context);
                    }
                }, delay);
            });
        } else {
            // 토론 시간이 아닌 경우는 기존 로직 유지
            const shuffledBots = aliveBots.sort(() => Math.random() - 0.5);
            
            shuffledBots.forEach((bot, index) => {
                const delay = 2000 + (Math.random() * 10000);
                
                setTimeout(() => {
                    if (room.gameState === phase && bot.alive) {
                        this.generateBotChat(room, bot, phase, context);
                    }
                }, delay);
            });
        }
    }

    // 마피아 봇들의 밤 시간 채팅
    triggerMafiaChats(room) {
        if (!room || !room.bots) {
            console.log('[에러] triggerMafiaChats: room 또는 bots가 존재하지 않음');
            return;
        }
        
        const aliveMafiaBots = Array.from(room.bots.values()).filter(
            bot => bot.alive && bot.role === 'mafia'
        );
        
        aliveMafiaBots.forEach((mafiaBot, index) => {
            // 밤 시간 초반에 계획 세우기
            setTimeout(() => {
                // 타이머 실행 시점에 room 상태 재확인
                if (room && room.gameState === 'night' && mafiaBot.alive) {
                    this.generateMafiaChat(room, mafiaBot, { planning: true });
                }
            }, Math.random() * 5000 + 3000); // 3-8초 후
        });
    }

    // 📈 고급 추리 시스템 - 게임 상황 종합 분석
    performAdvancedDeduction(room, bot) {
            const history = this.gameHistory.get(room.code);
            if (!history) return null;

        const alivePlayers = this.getAlivePlayers(room);
        const analysis = {
            playerProfiles: new Map(),
            gamePhase: this.determineGamePhase(room, alivePlayers),
            mafiaEstimate: this.estimateMafiaMembers(room, history, alivePlayers),
            roleDeductions: this.deducePlayerRoles(room, history, alivePlayers),
            votingAnalysis: this.analyzeVotingPatterns(room, history),
            survivalAnalysis: this.analyzeSurvivalPatterns(room, history),
            chatAnalysis: this.performChatAnalysis(room, history),
            threats: this.identifyThreatsAndAllies(room, history, alivePlayers, bot)
        };

        // 각 플레이어에 대한 종합 프로필 생성
        for (const player of alivePlayers) {
            analysis.playerProfiles.set(player.id, this.createPlayerProfile(player, analysis, bot));
        }

        return analysis;
    }

    // 게임 페이즈 판단
    determineGamePhase(room, alivePlayers) {
        const totalPlayers = room.players.size + room.bots.size;
        const aliveCount = alivePlayers.length;
        const round = room.round;

        if (round <= 2) return 'early';
        if (aliveCount <= 4 || aliveCount / totalPlayers <= 0.5) return 'late';
        return 'middle';
    }

    // 마피아 멤버 추정
    estimateMafiaMembers(room, history, alivePlayers) {
        const estimates = new Map();
        
        for (const player of alivePlayers) {
            let mafiaLikelihood = 0;
            
            // 1. 밤 생존 패턴 (마피아는 밤에 안 죽음)
            mafiaLikelihood += this.calculateNightSurvivalScore(player.id, history) * 0.3;
            
            // 2. 투표 패턴 (마피아는 시민을 겨냥)
            mafiaLikelihood += this.calculateVotingScore(player.id, history) * 0.25;
            
            // 3. 발언 분석 (거짓말 패턴)
            mafiaLikelihood += this.calculateDeceptionScore(player.id, history) * 0.25;
            
            // 4. 행동 일관성 (마피아는 모순된 행동)
            mafiaLikelihood += this.calculateInconsistencyScore(player.id, history) * 0.2;
            
            estimates.set(player.id, Math.max(0, Math.min(100, mafiaLikelihood)));
        }

        return estimates;
    }

    // 플레이어 역할 추론 - 개선됨
    deducePlayerRoles(room, history, alivePlayers) {
        const roleDeductions = new Map();
        
        for (const player of alivePlayers) {
            const deduction = {
                mostLikelyRole: 'citizen',
                confidence: 30, // 기본 시민 추정
                reasons: [],
                eliminatedRoles: []
            };

            // 🔍 1. 실제 조사 기록 우선 확인 (가장 중요)
            const actualInvestigations = this.findPlayerInvestigations(player.id, history);
            if (actualInvestigations.length > 0) {
                deduction.mostLikelyRole = 'police';
                deduction.confidence = 95; // 실제 조사 기록 = 거의 확실히 경찰
                deduction.reasons.push('실제 조사 기록 존재 - 진짜 경찰');
                console.log(`[역할 추론] ${player.id}: 실제 조사 기록 → 경찰 (95%)`);
            }

            // 🔍 2. 플레이어 자신에 대한 조사 결과 확인
            const investigationResults = this.getInvestigationResults(player.id, history);
            if (investigationResults.length > 0) {
                const latestResult = investigationResults[investigationResults.length - 1];
                if (latestResult.result === 'not_mafia') {
                    deduction.eliminatedRoles.push('mafia');
                    deduction.reasons.push('경찰 조사 결과: 마피아 아님');
                    if (deduction.confidence < 60) {
                        deduction.confidence = 60; // 조사로 입증된 시민
                    }
                } else if (latestResult.result === 'mafia') {
                    deduction.mostLikelyRole = 'mafia';
                    deduction.confidence = 90;
                    deduction.reasons.push('경찰 조사 결과: 마피아');
                }
            }

            // 🔍 3. 정보 주장과 역할 주장 분석
            const statements = history.playerStatements.get(player.id);
            if (statements) {
                const roleClaims = statements.roleClaims || [];
                const informationClaims = statements.informationClaims || [];
                
                // 조사 정보 제공자 분석
                const investigationClaims = informationClaims.filter(ic => ic.type === 'investigation');
                if (investigationClaims.length > 0) {
                    if (actualInvestigations.length > 0) {
                        // 실제 조사 + 정보 발표 = 확실한 경찰
                        deduction.mostLikelyRole = 'police';
                        deduction.confidence = 98;
                        deduction.reasons.push('조사 기록 + 정보 발표 - 확실한 경찰');
                    } else {
                        // 조사 기록 없이 조사 정보 주장 = 의심스러움
                        const hasPoliceRoleClaim = roleClaims.some(rc => rc.role === 'police');
                        if (hasPoliceRoleClaim) {
                            deduction.mostLikelyRole = 'citizen'; // 거짓 경찰 주장자
                            deduction.confidence = 45;
                            deduction.reasons.push('경찰 주장하지만 조사 기록 없음');
                        } else {
                            deduction.mostLikelyRole = 'mafia'; // 의심스러움
                            deduction.confidence = 60;
                            deduction.reasons.push('조사 정보만 주장, 역할 주장 없음');
                        }
                    }
                }
                
                // 🔍 4. 역할 주장 신뢰도 분석 (조사 기록 없는 경우만)
                if (deduction.confidence < 70 && roleClaims.length > 0) {
                    const latestClaim = roleClaims[roleClaims.length - 1];
                    const claimCredibility = this.verifyRoleClaim(player.id, latestClaim, history);
                    
                    if (claimCredibility > deduction.confidence) {
                        deduction.mostLikelyRole = latestClaim.role;
                        deduction.confidence = claimCredibility;
                        deduction.reasons.push(`${latestClaim.role} 주장 (신뢰도: ${claimCredibility}%)`);
                    }
                }
            }

            // 🔍 5. 행동 패턴 분석 (보조적)
            if (deduction.confidence < 60) {
                const behaviorAnalysis = this.analyzeBehaviorForRole(player.id, history);
                if (behaviorAnalysis.suspectedRole !== 'unknown' && behaviorAnalysis.confidence > deduction.confidence) {
                    deduction.mostLikelyRole = behaviorAnalysis.suspectedRole;
                    deduction.confidence = behaviorAnalysis.confidence;
                    deduction.reasons.push(`행동 패턴: ${behaviorAnalysis.suspectedRole} (${behaviorAnalysis.confidence}%)`);
                }
            }

            // 최종 확인 - 기본값 보장
            if (deduction.confidence === 0) {
                deduction.mostLikelyRole = 'citizen';
                deduction.confidence = 30;
                deduction.reasons.push('기본 시민 추정');
            }

            roleDeductions.set(player.id, deduction);
        }

        return roleDeductions;
    }

    // 투표 패턴 분석
    analyzeVotingPatterns(room, history) {
        const patterns = new Map();
        
        for (const round of history.rounds) {
            if (round.votes) {
                for (const [voter, target] of Object.entries(round.votes)) {
                    if (!patterns.has(voter)) {
                        patterns.set(voter, {
                            totalVotes: 0,
                            targetsKilled: 0,
                            targetsSurvived: 0,
                            votedForMafia: 0,
                            votedForCitizen: 0,
                            followedMajority: 0,
                            ledMajority: 0
                        });
                    }

                    const pattern = patterns.get(voter);
                    pattern.totalVotes++;

                    // 투표 대상이 그 라운드에 죽었는지 확인
                    if (round.eliminated && round.eliminated.id === target) {
                        pattern.targetsKilled++;
                        if (round.eliminated.role === 'mafia') {
                            pattern.votedForMafia++;
                        } else {
                            pattern.votedForCitizen++;
                        }
                    } else {
                        pattern.targetsSurvived++;
                    }
                }
            }
        }

        return patterns;
    }

    // 생존 패턴 분석
    analyzeSurvivalPatterns(room, history) {
        const patterns = new Map();
        const alivePlayers = this.getAlivePlayers(room);
        
        for (const player of alivePlayers) {
            const pattern = {
                nightsSurvived: 0,
                daysSurvived: 0,
                timesAttacked: 0,
                timesSaved: 0,
                attackedEarlyRounds: 0,
                attackedLateRounds: 0
            };

            // 밤 생존 분석
            for (const round of history.rounds) {
                if (round.nightDeaths && !round.nightDeaths.includes(player.id)) {
                    pattern.nightsSurvived++;
                }
                if (round.nightDeaths && round.nightDeaths.includes(player.id)) {
                    pattern.timesAttacked++;
                    if (round.round <= 2) {
                        pattern.attackedEarlyRounds++;
                    } else {
                        pattern.attackedLateRounds++;
                    }
                }
            }

            patterns.set(player.id, pattern);
        }

        return patterns;
    }

    // 채팅 분석
    performChatAnalysis(room, history) {
        const analysis = new Map();
        
        for (const [playerId, statements] of history.playerStatements) {
            const playerAnalysis = {
                trustworthiness: 0,
                consistency: 0,
                informativeness: 0,
                defensiveness: 0,
                suspiciousness: 0,
                keyBehaviors: []
            };

            // 일관성 분석
            playerAnalysis.consistency = this.analyzeStatementConsistency(playerId, statements, history);
            
            // 정보 제공 분석
            playerAnalysis.informativeness = this.analyzeInformationValue(statements);
            
            // 방어적 성향 분석
            playerAnalysis.defensiveness = this.analyzeDefensiveBehavior(statements);
            
            // 의심스러운 행동 분석
            playerAnalysis.suspiciousness = this.analyzeSuspiciousBehavior(statements);
            
            // 종합 신뢰도 계산
            playerAnalysis.trustworthiness = this.calculateOverallTrustworthiness(playerAnalysis);

            analysis.set(playerId, playerAnalysis);
        }

        return analysis;
    }

    // 위협과 아군 식별 (🔒 치팅 방지)
    identifyThreatsAndAllies(room, history, alivePlayers, bot) {
        const threats = [];
        const allies = [];
        const unknowns = [];

        for (const player of alivePlayers) {
            if (player.id === bot.id) continue;

            const mafiaLikelihood = this.estimateMafiaMembers(room, history, alivePlayers).get(player.id) || 0;
            const roleDeduction = this.deducePlayerRoles(room, history, alivePlayers).get(player.id);
            
            if (bot.role === 'mafia') {
                // 🔒 **마피아만** 동료 정보에 접근 가능 (게임 규칙상 마피아끼리는 서로 알고 있음)
                if (player.role === 'mafia') {
                    allies.push({ player, relationship: 'fellow_mafia', confidence: 100 });
                } else if (roleDeduction && roleDeduction.mostLikelyRole === 'police') {
                    threats.push({ player, threat: 'police', confidence: roleDeduction.confidence });
                } else if (roleDeduction && roleDeduction.mostLikelyRole === 'doctor') {
                    threats.push({ player, threat: 'doctor', confidence: roleDeduction.confidence });
                    } else {
                    unknowns.push({ player, mafiaLikelihood });
                }
            } else {
                // 🚫 **시민팀 봇들은 실제 역할 정보에 접근 불가** (치팅 방지)
                // 오직 추리와 관찰만으로 판단!
                if (mafiaLikelihood > 70) {
                    threats.push({ player, threat: 'suspected_mafia', confidence: mafiaLikelihood });
                } else if (mafiaLikelihood < 30) {
                    allies.push({ player, relationship: 'likely_citizen', confidence: 100 - mafiaLikelihood });
                } else {
                    unknowns.push({ player, mafiaLikelihood });
                }
            }
        }

        return { threats, allies, unknowns };
    }

    // 플레이어 프로필 생성
    createPlayerProfile(player, analysis, bot) {
        const profile = {
            playerId: player.id,
            playerName: player.name,
            suspectedRole: 'unknown',
            mafiaLikelihood: 0,
            trustLevel: 50,
            threatLevel: 0,
            allyLevel: 0,
            keyTraits: [],
            votePriority: 0,
            protectionPriority: 0,
            investigationPriority: 0
        };

        // 마피아 가능성
        if (analysis.mafiaEstimate.has(player.id)) {
            profile.mafiaLikelihood = analysis.mafiaEstimate.get(player.id);
        }

        // 추론된 역할
        if (analysis.roleDeductions.has(player.id)) {
            const roleDeduction = analysis.roleDeductions.get(player.id);
            profile.suspectedRole = roleDeduction.mostLikelyRole;
            profile.keyTraits.push(...roleDeduction.reasons);
        }

        // 채팅 분석
        if (analysis.chatAnalysis.has(player.id)) {
            const chatAnalysis = analysis.chatAnalysis.get(player.id);
            profile.trustLevel = chatAnalysis.trustworthiness;
            profile.keyTraits.push(`채팅 신뢰도: ${chatAnalysis.trustworthiness}`);
        }

        // 위협/아군 관계
        const relationship = analysis.threats.threats.find(t => t.player.id === player.id) ||
                            analysis.threats.allies.find(a => a.player.id === player.id);
        
        if (relationship) {
            if (relationship.threat) {
                profile.threatLevel = relationship.confidence;
                profile.keyTraits.push(`위협: ${relationship.threat}`);
            } else if (relationship.relationship) {
                profile.allyLevel = relationship.confidence;
                profile.keyTraits.push(`아군: ${relationship.relationship}`);
            }
        }

        // 우선순위 계산
        profile.votePriority = this.calculateVotePriority(profile, bot);
        profile.protectionPriority = this.calculateProtectionPriority(profile, bot);
        profile.investigationPriority = this.calculateInvestigationPriority(profile, bot);

        return profile;
    }

    // 투표 우선순위 계산 - 개선됨
    calculateVotePriority(profile, bot) {
        let priority = 0;

        if (bot.role === 'mafia') {
            // 마피아: 시민 진영 제거 우선
            if (profile.suspectedRole === 'police') {
                priority += 95; // 경찰 최우선 제거
                console.log(`[마피아 우선순위] ${bot.name}: 경찰 ${profile.playerName} 최우선 타겟 (95)`);
            } else if (profile.suspectedRole === 'doctor') {
                priority += 85; // 의사 두 번째 우선순위
                console.log(`[마피아 우선순위] ${bot.name}: 의사 ${profile.playerName} 우선 타겟 (85)`);
            } else if (profile.allyLevel > 60) {
                priority += 75; // 신뢰받는 시민
                console.log(`[마피아 우선순위] ${bot.name}: 신뢰받는 시민 ${profile.playerName} 타겟 (75)`);
        } else {
                priority += Math.min(60, profile.trustLevel); // 일반 시민 (상한선 설정)
            }
        } else {
            // 🚨 **핵심**: 시민은 경찰/의사를 절대 보호해야 함
            if (profile.suspectedRole === 'police') {
                priority = 0; // 경찰은 절대 투표하지 않음
                console.log(`[경찰 완전 보호] ${bot.name}: ${profile.playerName}을 경찰로 확신, 투표 완전 제외`);
            } else if (profile.suspectedRole === 'doctor') {
                priority = 0; // 의사도 절대 투표하지 않음
                console.log(`[의사 완전 보호] ${bot.name}: ${profile.playerName}을 의사로 확신, 투표 완전 제외`);
            } else if (profile.keyTraits.includes('실제 조사 기록')) {
                // 실제 조사 기록이 있는 플레이어는 절대 보호
                priority = 0;
                console.log(`[진짜 경찰 보호] ${bot.name}: ${profile.playerName}에게 조사 기록 있음, 완전 보호`);
            } else if (profile.keyTraits.includes('조사 기록 + 정보 발표')) {
                // 조사 기록 + 정보 발표자는 절대 보호
                priority = 0;
                console.log(`[확실한 경찰 보호] ${bot.name}: ${profile.playerName} 확실한 경찰, 완전 보호`);
            } else if (profile.suspectedRole === 'mafia') {
                // 마피아 의심자 우선 투표
                priority += Math.min(90, profile.mafiaLikelihood + 20);
                console.log(`[마피아 의심] ${bot.name}: ${profile.playerName} 마피아 의심 (+${priority})`);
            } else if (profile.mafiaLikelihood > 60) {
                // 높은 마피아 가능성
                priority += profile.mafiaLikelihood;
                console.log(`[높은 의심] ${bot.name}: ${profile.playerName} 높은 마피아 가능성 (+${priority})`);
            } else if (profile.threatLevel > 50) {
                // 위협적인 플레이어
                priority += Math.min(40, profile.threatLevel);
                console.log(`[위협 플레이어] ${bot.name}: ${profile.playerName} 위협적 (+${priority})`);
            } else if (profile.trustLevel < 30) {
                // 신뢰도 낮은 플레이어
                priority += Math.min(30, 50 - profile.trustLevel);
                console.log(`[신뢰도 낮음] ${bot.name}: ${profile.playerName} 신뢰도 낮음 (+${priority})`);
            } else {
                // 기본 우선순위 (매우 낮음)
                priority = Math.max(5, 20 - profile.trustLevel);
                console.log(`[기본 우선순위] ${bot.name}: ${profile.playerName} 기본 (+${priority})`);
            }
        }

        return Math.max(0, Math.min(100, priority));
    }

    // 보호 우선순위 계산
    calculateProtectionPriority(profile, bot) {
        if (bot.role !== 'doctor') return 0;

        let priority = 0;

        if (profile.suspectedRole === 'police') priority += 80;
        else if (profile.suspectedRole === 'doctor') priority += 70;
        else if (profile.allyLevel > 60) priority += 60;
        else priority += profile.trustLevel;

        // 마피아 의심자는 보호 안 함
        if (profile.mafiaLikelihood > 50) priority = 0;

        return Math.max(0, Math.min(100, priority));
    }

    // 조사 우선순위 계산
    calculateInvestigationPriority(profile, bot) {
        if (bot.role !== 'police') return 0;

        let priority = 0;

        priority += profile.mafiaLikelihood;
        if (profile.suspectedRole === 'unknown') priority += 20;
        if (profile.threatLevel > 40) priority += 15;

        // 이미 조사한 플레이어는 우선순위 낮음
        // (실제 구현에서는 조사 히스토리 확인 필요)

        return Math.max(0, Math.min(100, priority));
    }

    // 📊 개선된 투표 결정 시스템 (다양성 추가)
    makeSmartVoteDecision(room, bot) {
        const analysis = this.performAdvancedDeduction(room, bot);
        if (!analysis) {
            console.log(`[스마트 투표] ${bot.name}: 분석 실패, null 반환`);
            return null;
        }

        let alivePlayers = this.getAlivePlayers(room).filter(p => p.id !== bot.id);
        
        // 🚨 **핵심**: 마피아는 동료 마피아를 투표 대상에서 제외
        if (bot.role === 'mafia') {
            alivePlayers = alivePlayers.filter(p => p.role !== 'mafia');
            console.log(`[마피아 동료 제외] ${bot.name}: 마피아 동료들을 투표 후보에서 제외`);
        }
        
        const candidates = [];

        // 각 봇에 고유한 성향 부여
        const botPersonality = this.getBotPersonality(bot);
        console.log(`[스마트 투표] ${bot.name} (${bot.role}): 성향 ${botPersonality.type} 적용`);

        for (const player of alivePlayers) {
            const profile = analysis.playerProfiles.get(player.id);
            if (profile && profile.votePriority > 0) {
                // 봇의 성향에 따라 우선순위 조정
                const adjustedPriority = this.adjustPriorityByPersonality(profile.votePriority, profile, botPersonality);
                
                candidates.push({
                    player: player,
                    profile: profile,
                    priority: adjustedPriority,
                    reason: this.generateVoteReason(profile, bot)
                });
                
                console.log(`[투표 후보] ${player.name}: 기본 ${profile.votePriority} → 조정 ${adjustedPriority}`);
            }
        }

        // 우선순위에 따라 정렬
        candidates.sort((a, b) => b.priority - a.priority);

        // 강화된 다양성 확보 시스템
        if (candidates.length > 0) {
            const topPriority = candidates[0].priority;
            // 더 넓은 다양성 범위 (상위 30% 또는 최소 15점 차이)
            const diversityRange = Math.max(15, Math.floor(topPriority * 0.3));
            const topCandidates = candidates.filter(c => c.priority >= topPriority - diversityRange);
            
            console.log(`[다양성 확보] 상위 그룹: ${topCandidates.length}명 (범위: ${topPriority - diversityRange}~${topPriority})`);
            
            // 추가 다양성 로직: 봇 ID 기반 선택 편향
            const botIndex = this.hashString(bot.id) % topCandidates.length;
            const diversityBonus = Math.floor(Math.random() * 10) - 5; // ±5 추가 무작위성
            
            let selectedCandidate;
            if (topCandidates.length > 1) {
                // 성향 선택 + 봇별 고유 선택 경향
                selectedCandidate = this.selectByPersonality(topCandidates, botPersonality);
                
                // 20% 확률로 다른 후보 선택 (더 높은 무작위성)
                if (Math.random() < 0.2) {
                    const alternativeIndex = (botIndex + 1) % topCandidates.length;
                    selectedCandidate = topCandidates[alternativeIndex];
                    console.log(`[무작위 선택] ${bot.name}: 다양성을 위한 대안 선택`);
                }
            } else {
                selectedCandidate = topCandidates[0];
            }
            
            console.log(`[스마트 투표] ${bot.name} (${bot.role}): ${selectedCandidate.player.name} 선택 (우선순위: ${selectedCandidate.priority}, 이유: ${selectedCandidate.reason})`);
            return selectedCandidate.player;
        }

        console.log(`[스마트 투표] ${bot.name}: 적합한 후보자 없음`);
        return null;
    }

    // 봇 성향 시스템
    getBotPersonality(bot) {
        // 봇 이름의 해시를 기반으로 일관된 성향 부여
        const nameHash = this.hashString(bot.name || bot.id);
        const personalities = ['aggressive', 'cautious', 'analytical', 'intuitive', 'balanced'];
        const personalityIndex = nameHash % personalities.length;
        
        const traits = {
            aggressive: { riskTolerance: 0.8, suspicionThreshold: 0.6, preferredTarget: 'high_threat' },
            cautious: { riskTolerance: 0.3, suspicionThreshold: 0.8, preferredTarget: 'safe_choice' },
            analytical: { riskTolerance: 0.5, suspicionThreshold: 0.7, preferredTarget: 'logical_choice' },
            intuitive: { riskTolerance: 0.7, suspicionThreshold: 0.5, preferredTarget: 'gut_feeling' },
            balanced: { riskTolerance: 0.5, suspicionThreshold: 0.65, preferredTarget: 'balanced' }
        };
        
        return {
            type: personalities[personalityIndex],
            ...traits[personalities[personalityIndex]]
        };
    }
    
    // 문자열 해시 함수
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 32비트 정수 변환
        }
        return Math.abs(hash);
    }
    
    // 성향에 따른 우선순위 조정
    adjustPriorityByPersonality(basePriority, profile, personality) {
        let adjustedPriority = basePriority;
        
        console.log(`[성향 조정] 봇 성향: ${personality.type}, 기본 우선순위: ${basePriority}`);
        
        // 성향별 조정
        switch (personality.type) {
            case 'aggressive':
                // 공격적: 높은 위험도 선호, 확실한 의심 대상 우선
                if (profile.mafiaLikelihood > 80) adjustedPriority += 15;
                if (profile.threatLevel > 70) adjustedPriority += 12;
                if (profile.mafiaLikelihood < 40) adjustedPriority -= 8;
                break;
                
            case 'cautious':
                // 신중한: 확실한 증거 선호, 안전한 선택
                if (profile.mafiaLikelihood > 90) adjustedPriority += 20;
                if (profile.trustLevel < 20) adjustedPriority += 10;
                if (profile.mafiaLikelihood < 60) adjustedPriority -= 10;
                break;
                
            case 'analytical':
                // 분석적: 논리적 근거 선호
                if (profile.keyTraits.includes('모순 발언')) adjustedPriority += 18;
                if (profile.keyTraits.includes('정보 제공')) adjustedPriority += 12;
                if (profile.keyTraits.includes('논리적 추리')) adjustedPriority += 10;
                break;
                
            case 'intuitive':
                // 직관적: 감정적 판단, 변화 선호
                const randomFactor = (Math.random() - 0.5) * 20;
                adjustedPriority += randomFactor;
                if (profile.keyTraits.includes('방어적')) adjustedPriority += 12;
                if (profile.keyTraits.includes('의심스런 행동')) adjustedPriority += 8;
                break;
                
            case 'balanced':
                // 균형잡힌: 종합적 판단
                const avgScore = (profile.mafiaLikelihood + profile.threatLevel + (100 - profile.trustLevel)) / 3;
                if (avgScore > 70) adjustedPriority += 10;
                else if (avgScore > 50) adjustedPriority += 5;
                else if (avgScore < 30) adjustedPriority -= 5;
                break;
        }
        
        // 성향별 차별화된 무작위 요소
        let randomRange = 30; // 기본 범위
        switch (personality.type) {
            case 'aggressive':
                randomRange = 25; // 더 일관된 선택
                break;
            case 'cautious':
                randomRange = 20; // 신중한 선택
                break;
            case 'analytical':
                randomRange = 15; // 논리적 선택
                break;
            case 'intuitive':
                randomRange = 40; // 높은 변동성
                break;
            case 'balanced':
                randomRange = 30; // 균형잡힌 변동성
                break;
        }
        
        const randomAdjustment = (Math.random() - 0.5) * randomRange;
        adjustedPriority += randomAdjustment;
        
        // 최종 안전성 확인
        const finalPriority = Math.max(0, Math.round(adjustedPriority));
        
        console.log(`[성향 조정] 조정된 우선순위: ${finalPriority}`);
        
        return finalPriority;
    }
    
    // 성향에 따른 선택
    selectByPersonality(candidates, personality) {
        console.log(`[성향 선택] 성향: ${personality.type}, 후보자 수: ${candidates.length}`);
        
        // 후보자가 1명이면 그대로 반환
        if (candidates.length === 1) {
            return candidates[0];
        }
        
        switch (personality.type) {
            case 'aggressive':
                // 가장 위험한 대상 선택 (마피아 가능성 높은 순)
                const aggressiveChoice = candidates.reduce((prev, curr) => 
                    (curr.profile.mafiaLikelihood > prev.profile.mafiaLikelihood) ? curr : prev
                );
                console.log(`[성향 선택] 공격적 선택: ${aggressiveChoice.player.name}`);
                return aggressiveChoice;
                
            case 'cautious':
                // 가장 확실한 대상 선택 (90% 이상 확신할 때만)
                const cautiousCandidates = candidates.filter(c => c.profile.mafiaLikelihood > 90);
                if (cautiousCandidates.length > 0) {
                    const cautiousChoice = cautiousCandidates[0];
                    console.log(`[성향 선택] 신중한 선택: ${cautiousChoice.player.name}`);
                    return cautiousChoice;
                }
                // 확실한 대상이 없으면 가장 높은 우선순위
                console.log(`[성향 선택] 신중한 선택(fallback): ${candidates[0].player.name}`);
                return candidates[0];
                
            case 'analytical':
                // 가장 논리적 근거가 많은 대상 선택
                const analyticalChoice = candidates.reduce((prev, curr) => 
                    (curr.profile.keyTraits.length > prev.profile.keyTraits.length) ? curr : prev
                );
                console.log(`[성향 선택] 분석적 선택: ${analyticalChoice.player.name}`);
                return analyticalChoice;
                
            case 'intuitive':
                // 무작위 선택 (직감), 하지만 상위 50% 중에서만
                const topHalf = candidates.slice(0, Math.ceil(candidates.length / 2));
                const intuitiveChoice = topHalf[Math.floor(Math.random() * topHalf.length)];
                console.log(`[성향 선택] 직관적 선택: ${intuitiveChoice.player.name}`);
                return intuitiveChoice;
                
            case 'balanced':
            default:
                // 첫 번째 (가장 높은 우선순위)
                console.log(`[성향 선택] 균형잡힌 선택: ${candidates[0].player.name}`);
                return candidates[0];
        }
    }

    // 투표 이유 생성
    generateVoteReason(profile, bot) {
        const reasons = [];
        
        if (profile.mafiaLikelihood > 70) reasons.push('마피아 의심');
        if (profile.suspectedRole === 'mafia') reasons.push('마피아 역할 추정');
        if (profile.threatLevel > 50) reasons.push('위협 인물');
        if (profile.trustLevel < 30) reasons.push('신뢰도 낮음');
        if (profile.keyTraits.includes('모순 발언')) reasons.push('발언 모순');
        
        return reasons.length > 0 ? reasons.join(', ') : '전략적 선택';
    }

    // 시민 봇 투표 전략 (개선됨)
    chooseCitizenVoteTarget(room, citizenBot) {
        console.log(`[시민 AI] ${citizenBot.name}: 고급 추리 시작`);
        
        // 고급 추리 시스템 사용
        const smartChoice = this.makeSmartVoteDecision(room, citizenBot);
        if (smartChoice) {
            return smartChoice;
        }

        // 기존 로직 fallback
        const analysis = this.analyzeGameState(room);
        if (!analysis) return this.chooseRandomTarget(room, citizenBot, 'citizen');

        console.log(`[시민 AI] ${citizenBot.name}: 기본 전략으로 전환`);
        
        const history = this.gameHistory.get(room.code);
        const alivePlayers = this.getAlivePlayers(room).filter(p => p.id !== citizenBot.id);

        // 봇 성향을 기본 전략에도 적용
        const botPersonality = this.getBotPersonality(citizenBot);
        
        // 의심도가 높은 플레이어 (성향별 임계값 조정)
        let suspicionThreshold = 20;
        if (botPersonality.type === 'aggressive') suspicionThreshold = 15;
        else if (botPersonality.type === 'cautious') suspicionThreshold = 35;
        else if (botPersonality.type === 'analytical') suspicionThreshold = 25;
        
        const suspiciousPlayers = analysis.suspiciousPlayers.filter(p => 
            p.player.id !== citizenBot.id && p.suspicion > suspicionThreshold
        );

        if (suspiciousPlayers.length > 0) {
            // 🚨 **핵심**: 경찰/의사로 추정되는 플레이어는 제외
            const history = this.gameHistory.get(room.code);
            const filteredSuspiciousPlayers = suspiciousPlayers.filter(p => {
                // 경찰 추정: 조사 결과 발표, 정보 제공 패턴
                if (history && history.playerStatements && history.playerStatements.has(p.player.id)) {
                    const statements = history.playerStatements.get(p.player.id);
                    const hasInvestigationClaims = statements.informationClaims.length > 0;
                    const hasPoliceRoleClaim = statements.roleClaims.some(claim => claim.role === 'police');
                    
                    if (hasInvestigationClaims || hasPoliceRoleClaim) {
                        console.log(`[경찰 보호] ${citizenBot.name}: ${p.player.name}을 경찰로 추정, 투표 제외`);
                        return false;
                    }
                }
                return true;
            });
            
            if (filteredSuspiciousPlayers.length > 0) {
                // 다양성을 위한 선택 (항상 첫 번째가 아닌)
                const randomIndex = Math.floor(Math.random() * Math.min(3, filteredSuspiciousPlayers.length));
                const target = filteredSuspiciousPlayers[randomIndex].player;
                console.log(`[시민 AI] ${citizenBot.name}: 의심스러운 플레이어 ${target.name} 투표 선택 (의심도: ${filteredSuspiciousPlayers[randomIndex].suspicion})`);
                return target;
            }
        }

        // 신뢰도가 낮은 플레이어 (경찰/의사 제외)
        const lowTrustPlayers = analysis.trustedPlayers.filter(p => {
            if (p.player.id === citizenBot.id || p.trust >= 45) return false;
            
            // 경찰 추정: 조사 결과 발표, 정보 제공 패턴 (재확인)
            if (history && history.playerStatements && history.playerStatements.has(p.player.id)) {
                const statements = history.playerStatements.get(p.player.id);
                const hasInvestigationClaims = statements.informationClaims.length > 0;
                const hasPoliceRoleClaim = statements.roleClaims.some(claim => claim.role === 'police');
                
                if (hasInvestigationClaims || hasPoliceRoleClaim) {
                    console.log(`[경찰 보호] ${citizenBot.name}: ${p.player.name}을 경찰로 추정, 신뢰도 낮아도 투표 제외`);
                    return false;
                }
            }
            return true;
        }).sort((a, b) => a.trust - b.trust);

        if (lowTrustPlayers.length > 0) {
            // 다양성을 위한 선택
            const randomIndex = Math.floor(Math.random() * Math.min(2, lowTrustPlayers.length));
            const target = lowTrustPlayers[randomIndex].player;
            console.log(`[시민 AI] ${citizenBot.name}: 신뢰도 낮은 플레이어 ${target.name} 투표 선택 (신뢰도: ${lowTrustPlayers[randomIndex].trust})`);
            return target;
        }

        // 무작위 선택
        console.log(`[시민 AI] ${citizenBot.name}: 전략적 대상 없음, 무작위 선택`);
        return this.chooseRandomTarget(room, citizenBot, 'citizen');
    }

    // 마피아 봇 투표 전략 (개선됨)
    chooseMafiaVoteTarget(room, mafiaBot) {
        console.log(`[마피아 투표 AI] ${mafiaBot.name}: 고급 추리 시작`);
        
        // 🚨 **핵심**: 다른 마피아는 절대 투표하면 안됨
        const alivePlayers = this.getAlivePlayers(room).filter(p => p.id !== mafiaBot.id);
        const mafiaPlayers = alivePlayers.filter(p => p.role === 'mafia');
        const nonMafiaPlayers = alivePlayers.filter(p => p.role !== 'mafia');
        
        console.log(`[마피아 동료 보호] ${mafiaBot.name}: 마피아 동료 ${mafiaPlayers.length}명 보호`);
        
        // 고급 추리 시스템 사용 (마피아가 아닌 플레이어만 대상)
        const smartChoice = this.makeSmartVoteDecision(room, mafiaBot);
        if (smartChoice && smartChoice.role !== 'mafia') {
            console.log(`[마피아 스마트 선택] ${mafiaBot.name}: ${smartChoice.name} 선택`);
            return smartChoice;
        }

        // 기존 로직 fallback
        const analysis = this.analyzeGameState(room);
        if (!analysis) return this.chooseRandomTarget(room, mafiaBot, 'mafia');

        console.log(`[마피아 투표 AI] ${mafiaBot.name}: 기본 전략으로 전환`);
        
        const history = this.gameHistory.get(room.code);

        // 봇 성향을 기본 전략에도 적용
        const botPersonality = this.getBotPersonality(mafiaBot);
        
        // 우선순위 1: 역할 주장자 (경찰, 의사 주장) 제거 (마피아 제외)
        if (history && history.playerStatements) {
            const roleClaimTargets = [];
            
            for (const player of alivePlayers) {
                const playerData = history.playerStatements.get(player.id);
                if (playerData && playerData.roleClaims) {
                    const dangerousClaims = playerData.roleClaims.filter(claim => 
                        claim.role === 'police' || claim.role === 'doctor'
                    );
                    if (dangerousClaims.length > 0) {
                        roleClaimTargets.push({
                            player: player,
                            claimedRole: dangerousClaims[0].role,
                            claimCount: dangerousClaims.length
                        });
                    }
                }
            }

            if (roleClaimTargets.length > 0) {
                // 경찰 주장자 우선, 그 다음 의사 주장자
                const policeClaimants = roleClaimTargets.filter(t => t.claimedRole === 'police');
                const doctorClaimants = roleClaimTargets.filter(t => t.claimedRole === 'doctor');
                
                let target = null;
                if (policeClaimants.length > 0) {
                    target = policeClaimants[0].player;
                    console.log(`[마피아 투표 AI] ${mafiaBot.name}: 경찰 주장자 ${target.name} 투표 선택`);
                } else if (doctorClaimants.length > 0) {
                    target = doctorClaimants[0].player;
                    console.log(`[마피아 투표 AI] ${mafiaBot.name}: 의사 주장자 ${target.name} 투표 선택`);
                }
                
                if (target) return target;
            }
        }

        // 우선순위 2: 신뢰도 높은 시민 (영향력 있는 플레이어)
        const trustedCitizens = analysis.trustedPlayers.filter(p => 
            p.player.id !== mafiaBot.id && p.trust > 60
        );

        if (trustedCitizens.length > 0) {
            const target = trustedCitizens[0].player;
            console.log(`[마피아 투표 AI] ${mafiaBot.name}: 신뢰받는 시민 ${target.name} 투표 선택 (신뢰도: ${trustedCitizens[0].trust})`);
            return target;
        }

        // 우선순위 3: 무고한 시민 (마피아가 아닌 플레이어)
        const innocentPlayers = alivePlayers.filter(p => p.role !== 'mafia');
        if (innocentPlayers.length > 0) {
            const target = innocentPlayers[Math.floor(Math.random() * innocentPlayers.length)];
            console.log(`[마피아 투표 AI] ${mafiaBot.name}: 무고한 시민 ${target.name} 투표 선택 (의심도: 0)`);
            return target;
        }

        // 마지막 수단: 무작위 선택
        console.log(`[마피아 투표 AI] ${mafiaBot.name}: 전략적 대상 없음, 무작위 선택`);
        return this.chooseRandomTarget(room, mafiaBot, 'mafia');
    }

    // 📊 보조 함수들 (고급 추리 시스템)

    // 밤 생존 점수 계산
    calculateNightSurvivalScore(playerId, history) {
        let score = 0;
        let nightsAlive = 0;
        let totalNights = 0;
        
        for (const round of history.rounds) {
            if (round.nightDeaths) {
                totalNights++;
                if (!round.nightDeaths.includes(playerId)) {
                    nightsAlive++;
                }
            }
        }
        
        if (totalNights > 0) {
            const survivalRate = nightsAlive / totalNights;
            // 생존율이 높을수록 마피아 가능성 증가
            if (survivalRate > 0.7) score += 30;
            else if (survivalRate > 0.5) score += 15;
        }
        
        return score;
    }

    // 투표 점수 계산
    calculateVotingScore(playerId, history) {
        let score = 0;
        let votedForMafia = 0;
        let votedForCitizen = 0;
        let totalVotes = 0;
        
        for (const round of history.rounds) {
            if (round.votes && round.votes[playerId]) {
                totalVotes++;
                const target = round.votes[playerId];
                
                if (round.eliminated && round.eliminated.id === target) {
                    if (round.eliminated.role === 'mafia') {
                        votedForMafia++;
                    } else {
                        votedForCitizen++;
                    }
                }
            }
        }
        
        if (totalVotes > 0) {
            // 시민을 더 많이 투표한 경우 마피아 가능성 증가
            if (votedForCitizen > votedForMafia) {
                score += 20;
            }
            
            // 마피아를 투표한 적이 거의 없는 경우
            if (votedForMafia === 0 && totalVotes > 1) {
                score += 15;
            }
        }
        
        return score;
    }

    // 기만 점수 계산
    calculateDeceptionScore(playerId, history) {
        let score = 0;
        
        if (history.playerStatements && history.playerStatements.has(playerId)) {
            const statements = history.playerStatements.get(playerId);
            
            // 모순 발언
            if (statements.contradictions && statements.contradictions.length > 0) {
                score += statements.contradictions.length * 10;
            }
            
            // 거짓 정보 주장
            if (statements.informationClaims) {
                for (const claim of statements.informationClaims) {
                    if (claim.type === 'investigation') {
                        // 경찰이 아닌데 조사 정보 주장
                        const isPolice = statements.roleClaims.some(rc => rc.role === 'police');
                        if (!isPolice) {
                            score += 25;
                        }
                    }
                }
            }
            
            // 과도한 방어적 발언
            if (statements.defensiveStatements && statements.defensiveStatements.length > 2) {
                score += statements.defensiveStatements.length * 5;
            }
        }
        
        return score;
    }

    // 일관성 점수 계산
    calculateInconsistencyScore(playerId, history) {
        let score = 0;
        
        if (history.playerStatements && history.playerStatements.has(playerId)) {
            const statements = history.playerStatements.get(playerId);
            
            // 역할 주장 변경
            if (statements.roleClaims && statements.roleClaims.length > 1) {
                const uniqueRoles = new Set(statements.roleClaims.map(rc => rc.role));
                if (uniqueRoles.size > 1) {
                    score += 30; // 역할 주장 변경은 큰 감점
                }
            }
            
            // 의심 대상 변경 패턴
            if (statements.suspicionClaims && statements.suspicionClaims.length > 0) {
                const targets = statements.suspicionClaims.map(sc => sc.target);
                const uniqueTargets = new Set(targets);
                if (uniqueTargets.size > 2) {
                    score += 10; // 너무 많은 사람을 의심
                }
            }
        }
        
        return score;
    }

    // 조사 결과 조회 - 개선됨
    getInvestigationResults(playerId, history) {
        const results = [];
        
        // 1. 현재 라운드에서 조사 결과 확인
        if (history.currentRound && history.currentRound.investigations) {
            for (const investigation of history.currentRound.investigations) {
                if (investigation.target === playerId) {
                    results.push(investigation);
                }
            }
        }
        
        // 2. 완료된 라운드들에서 조사 결과 확인
        for (const round of history.rounds) {
            if (round.investigations) {
                for (const investigation of round.investigations) {
                    if (investigation.target === playerId) {
                        results.push(investigation);
                    }
                }
            }
        }
        
        return results;
    }

    // 플레이어 역할 주장 조회
    getPlayerRoleClaims(playerId, history) {
        if (history.playerStatements && history.playerStatements.has(playerId)) {
            const statements = history.playerStatements.get(playerId);
            return statements.roleClaims || [];
        }
        return [];
    }

    // 역할 주장 검증
    verifyRoleClaim(playerId, claim, history) {
        let credibility = 50; // 기본 신뢰도
        
        // 경찰 주장 검증
        if (claim.role === 'police') {
            // 실제로 조사 결과를 발표했는지 확인
            const statements = history.playerStatements.get(playerId);
            if (statements && statements.informationClaims) {
                const investigationClaims = statements.informationClaims.filter(ic => ic.role === 'investigation');
                if (investigationClaims.length > 0) {
                    credibility += 30; // 조사 결과 발표
                }
            }
            
            // 실제 조사 기록과 비교
            const actualInvestigations = [];
            for (const round of history.rounds) {
                if (round.investigations) {
                    for (const investigation of round.investigations) {
                        if (investigation.investigator === playerId) {
                            actualInvestigations.push(investigation);
                        }
                    }
                }
            }
            
            if (actualInvestigations.length > 0) {
                credibility += 40; // 실제 조사 기록 존재
            }
        }
        
        // 의사 주장 검증
        if (claim.role === 'doctor') {
            // 치료/보호 관련 발언 확인
            const statements = history.playerStatements.get(playerId);
            if (statements && statements.informationClaims) {
                const healingClaims = statements.informationClaims.filter(ic => ic.type === 'healing');
                if (healingClaims.length > 0) {
                    credibility += 20;
                }
            }
        }
        
        return Math.max(0, Math.min(100, credibility));
    }

    // 행동 패턴으로 역할 분석
    analyzeBehaviorForRole(playerId, history) {
        const analysis = {
            suspectedRole: 'unknown',
            confidence: 0,
            reasons: []
        };
        
        // 투표 패턴 분석
        let votedForMafia = 0;
        let votedForCitizen = 0;
        
        for (const round of history.rounds) {
            if (round.votes && round.votes[playerId]) {
                const target = round.votes[playerId];
                if (round.eliminated && round.eliminated.id === target) {
                    if (round.eliminated.role === 'mafia') {
                        votedForMafia++;
                    } else {
                        votedForCitizen++;
                    }
                }
            }
        }
        
        // 마피아 패턴: 시민을 더 많이 투표
        if (votedForCitizen > votedForMafia && votedForCitizen > 1) {
            analysis.suspectedRole = 'mafia';
            analysis.confidence = 60;
            analysis.reasons.push('시민 대상 투표 패턴');
        }
        
        // 시민 패턴: 마피아를 찾으려 노력
        if (votedForMafia > 0 && votedForMafia >= votedForCitizen) {
            analysis.suspectedRole = 'citizen';
            analysis.confidence = 50;
            analysis.reasons.push('마피아 찾기 노력');
        }
        
        return analysis;
    }

    // 정보 가치 분석
    analyzeInformationValue(statements) {
        let value = 0;
        
        if (statements.informationClaims) {
            value += statements.informationClaims.length * 10;
        }
        
        if (statements.roleClaims) {
            value += statements.roleClaims.length * 5;
        }
        
        return Math.min(50, value);
    }

    // 방어적 행동 분석
    analyzeDefensiveBehavior(statements) {
        let defensiveness = 0;
        
        if (statements.defensiveStatements) {
            defensiveness += statements.defensiveStatements.length * 10;
        }
        
        return Math.min(50, defensiveness);
    }

    // 의심스러운 행동 분석
    analyzeSuspiciousBehavior(statements) {
        let suspicion = 0;
        
        if (statements.contradictions) {
            suspicion += statements.contradictions.length * 15;
        }
        
        // 너무 많은 사람 의심
        if (statements.suspicionClaims && statements.suspicionClaims.length > 3) {
            suspicion += 20;
        }
        
        return Math.min(50, suspicion);
    }

    // 종합 신뢰도 계산
    calculateOverallTrustworthiness(playerAnalysis) {
        let trustworthiness = 50; // 기본값
        
        trustworthiness += playerAnalysis.informativeness * 0.3;
        trustworthiness -= playerAnalysis.defensiveness * 0.4;
        trustworthiness -= playerAnalysis.suspiciousness * 0.5;
        trustworthiness += playerAnalysis.consistency * 0.2;
        
        return Math.max(0, Math.min(100, trustworthiness));
    }

    // 🆕 봇인지 확인하는 헬퍼 함수
    isBot(playerId, room) {
        return room.bots.has(playerId);
    }

    // 🆕 반응형 봇 채팅 트리거 (🚨 수정: 각 봇별로 개별 타겟 검사)
    triggerReactiveBotChats(room, chatMessage) {
        const aliveBots = Array.from(room.bots.values()).filter(bot => bot.alive);
        console.log(`[반응형 채팅 시작] 방코드: ${room.code}, 살아있는 봇 수: ${aliveBots.length}, 메시지: "${chatMessage.message}"`);
        console.log(`[살아있는 봇 목록] ${aliveBots.map(bot => `${bot.name}(${bot.id})`).join(', ')}`);
        if (!aliveBots.length) {
            console.log(`[반응형 채팅 종료] 살아있는 봇이 없음`);
            return;
        }

        // 🚨 **핵심**: 전체 타겟 목록을 먼저 찾고, 각 봇별로 자기가 타겟되었는지 확인
        console.log(`[게임 상태 확인] 현재 게임 상태: ${room.gameState}, 메시지 페이즈: ${chatMessage.gamePhase}`);
        
        // 🔧 **수정**: 전체 타겟 목록을 한 번만 계산
        const allTargetedBots = this.findTargetedBots(chatMessage, room, aliveBots, null);
        console.log(`[전체 타겟 결과] 타겟된 봇들: [${allTargetedBots.map(bot => bot.name).join(', ')}]`);
        
        aliveBots.forEach((bot, index) => {
            // 봇이 자기 자신의 메시지에 응답하지 않도록 체크
            if (bot.id === chatMessage.playerId) {
                console.log(`[반응형 채팅 제외] ${bot.name}: 자기 자신의 메시지에는 응답하지 않음`);
                return;
            }
            
            // 🔧 **수정**: 이 봇이 타겟되었는지 확인
            const isTargeted = allTargetedBots.some(targetBot => targetBot.id === bot.id);
            console.log(`[${bot.name} 타겟 결과] 타겟됨: ${isTargeted}`);
            
            if (isTargeted) {
                const delay = 800 + (index * 500) + Math.random() * 1200; // 0.8-2.5초 사이 응답 (빠른 반응)
                
                setTimeout(() => {
                    if (room.gameState === chatMessage.gamePhase && bot.alive) {
                        const responseMessage = this.generateReactiveResponse(room, bot, chatMessage);
                        if (responseMessage) {
                            console.log(`[반응형 채팅] ${bot.name}: "${chatMessage.message}"에 대한 응답 - "${responseMessage}"`);
                            
                            // 반응형 채팅 메시지 전송
                            this.addChatMessage(room.code, {
                                type: 'player',
                                playerId: bot.id,
                                playerName: bot.name,
                                message: responseMessage,
                                round: room.round,
                                gamePhase: room.gameState
                            }, room);

                            io.to(room.code).emit('chatMessage', {
                                type: 'player',
                                playerName: bot.name,
                                message: responseMessage,
                                timestamp: new Date()
                            });
                        } else {
                            console.log(`[반응형 채팅 실패] ${bot.name}: 응답 생성 실패 - "${chatMessage.message}"`);
                        }
                    } else {
                        console.log(`[반응형 채팅 취소] ${bot.name}: 게임 상태 변경됨 (${room.gameState} != ${chatMessage.gamePhase}) 또는 봇이 죽음`);
                    }
                }, delay);
            }
        });
        
        // 🆕 특별 반응: "누가 마피아냐?" 질문에 경찰/가짜경찰 우선 응답
        console.log(`[특별 반응 검사] 게임 상태: ${room.gameState}, 메시지: "${chatMessage.message}"`);
        if (this.isAskingWhoIsMafia(chatMessage.message.toLowerCase()) && 
            (room.gameState === 'discussion' || room.gameState === 'voting' || room.gameState === 'lobby')) {
            
            console.log(`[마피아 질문 특별 반응 시작] 조건 만족!`);
            
            // 경찰과 가짜 경찰 찾기
            const policeBots = aliveBots.filter(bot => bot.role === 'police');
            const fakePoliceBots = aliveBots.filter(bot => 
                bot.role === 'mafia' && this.isFakePoliceBot(room.code, bot.id)
            );
            const allPoliceBots = [...policeBots, ...fakePoliceBots];
            
            console.log(`[마피아 질문 특별 반응] 경찰 관련 봇 ${allPoliceBots.length}명 발견`);
            console.log(`[경찰 봇 목록] 진짜 경찰: ${policeBots.map(b => b.name).join(', ')}`);
            console.log(`[가짜 경찰 봇 목록] 가짜 경찰: ${fakePoliceBots.map(b => b.name).join(', ')}`);
            
            if (allPoliceBots.length > 0) {
                // 80% 확률로 경찰이 답변
                if (Math.random() < 0.8) {
                    const policeBot = allPoliceBots[Math.floor(Math.random() * allPoliceBots.length)];
                    const delay = 1000 + Math.random() * 2000; // 1-3초 빠른 응답
                    
                    setTimeout(() => {
                        if (room.gameState === chatMessage.gamePhase && policeBot.alive) {
                            const responseMessage = this.generateGeneralResponse(room, policeBot, chatMessage);
                            if (responseMessage) {
                                console.log(`[경찰 우선 답변] ${policeBot.name} (${policeBot.role}): 마피아 질문에 답변`);
                                
                                this.addChatMessage(room.code, {
                                    type: 'player',
                                    playerId: policeBot.id,
                                    playerName: policeBot.name,
                                    message: responseMessage,
                                    round: room.round,
                                    gamePhase: room.gameState
                                }, room);

                                io.to(room.code).emit('chatMessage', {
                                    type: 'player',
                                    playerName: policeBot.name,
                                    message: responseMessage,
                                    timestamp: new Date()
                                });
                            }
                        }
                    }, delay);
                }
            }
            
            // 다른 봇들도 낮은 확률로 추가 반응 (30% 확률)
            const otherBots = aliveBots.filter(bot => 
                !allPoliceBots.some(pBot => pBot.id === bot.id) && 
                bot.id !== chatMessage.playerId
            );
            
            if (otherBots.length > 0 && Math.random() < 0.3) {
                const randomBot = otherBots[Math.floor(Math.random() * otherBots.length)];
                const delay = 4000 + Math.random() * 3000; // 4-7초 지연 응답
                
                setTimeout(() => {
                    if (room.gameState === chatMessage.gamePhase && randomBot.alive) {
                        const responseMessage = this.generateGeneralResponse(room, randomBot, chatMessage);
                        if (responseMessage) {
                            console.log(`[추가 반응] ${randomBot.name}: 마피아 질문에 추가 응답`);
                            
                            this.addChatMessage(room.code, {
                                type: 'player',
                                playerId: randomBot.id,
                                playerName: randomBot.name,
                                message: responseMessage,
                                round: room.round,
                                gamePhase: room.gameState
                            }, room);

                            io.to(room.code).emit('chatMessage', {
                                type: 'player',
                                playerName: randomBot.name,
                                message: responseMessage,
                                timestamp: new Date()
                            });
                        }
                    }
                }, delay);
            }
        }
        // 일반적인 발언에 대한 확률적 반응 (20% 확률) - 마피아 질문이 아닌 경우만
        else if (Math.random() < 0.2 && (room.gameState === 'discussion' || room.gameState === 'voting')) {
            const randomBot = aliveBots[Math.floor(Math.random() * aliveBots.length)];
            const delay = 3000 + Math.random() * 4000; // 3-7초 사이 응답
            
            setTimeout(() => {
                if (room.gameState === chatMessage.gamePhase && randomBot.alive) {
                    const responseMessage = this.generateGeneralResponse(room, randomBot, chatMessage);
                    if (responseMessage) {
                        console.log(`[일반 반응] ${randomBot.name}: 일반적인 반응 생성`);
                        
                        this.addChatMessage(room.code, {
                            type: 'player',
                            playerId: randomBot.id,
                            playerName: randomBot.name,
                            message: responseMessage,
                            round: room.round,
                            gamePhase: room.gameState
                        }, room);

                        io.to(room.code).emit('chatMessage', {
                            type: 'player',
                            playerName: randomBot.name,
                            message: responseMessage,
                            timestamp: new Date()
                        });
                    }
                }
            }, delay);
        }
    }

    // 🆕 타겟이 된 봇들 찾기 (🔧 수정: excludeBot 제거)
    findTargetedBots(chatMessage, room, aliveBots, excludeBot = null) {
        const message = chatMessage.message.toLowerCase();
        const targetedBots = [];
        
        // 1. 직접 이름 언급
        for (const bot of aliveBots) {
            if (message.includes(bot.name.toLowerCase())) {
                targetedBots.push(bot);
                console.log(`[타겟 감지] 직접 이름 언급: ${bot.name}`);
            }
        }
        
        // 2. 🔧 **핵심 수정**: 패턴 매칭 전에 일반적인 외침인지 먼저 확인
        if (targetedBots.length === 0) {
            // 먼저 일반적인 외침인지 확인
            const isGeneralExclamation = this.isGeneralExclamation(message);
            if (isGeneralExclamation) {
                console.log(`[타겟 감지 제외] "${message}"는 일반적인 외침이므로 타겟 감지 중단`);
                // 일반적인 외침이면 더 이상 타겟 감지하지 않음
            } else {
                // 일반적인 외침이 아닐 때만 패턴 매칭 진행
                const accusationPatterns = [
                    /너.*거짓말/,
                    /넌.*거짓말/,
                    /왜.*의심/,
                    /너.*의심/,
                    /넌.*의심/,
                    /너.*마피아/,
                    /넌.*마피아/,
                    /너.*이상/,
                    /넌.*이상/,
                    /너.*수상/,
                    /넌.*수상/,
                    /대답해/,
                    /설명해/,
                    /해명해/,
                    // 🆕 추가 패턴들 (일반적인 외침 제외)
                    /의심스러워/,
                    /수상해/,
                    /이상해/,
                    /마피아 같/,
                    /거짓말하/,
                    /거짓말 하/,
                    /믿을 수 없/,
                    /신뢰 안/,
                    /의심해/,
                    /의심함/,
                    /수상함/,
                    /이상함/,
                    /문제있/,
                    /문제 있/
                ];
                
                // 패턴 매칭으로 타겟이 된 봇 찾기
                for (const pattern of accusationPatterns) {
                    if (pattern.test(message)) {
                        console.log(`[타겟 감지] 패턴 매칭: "${pattern}" - "${message}"`);
                        // 가장 최근에 발언한 봇을 타겟으로 선정
                        const recentBotMessages = this.getRecentBotMessages(room, 3);
                        if (recentBotMessages.length > 0) {
                            for (const recentMessage of recentBotMessages) {
                                const recentBot = aliveBots.find(bot => bot.id === recentMessage.playerId);
                                if (recentBot && !targetedBots.includes(recentBot)) {
                                    targetedBots.push(recentBot);
                                    console.log(`[타겟 감지] 최근 발언자 타겟: ${recentBot.name}`);
                                    break; // 첫 번째 적합한 봇만 타겟으로
                                }
                            }
                        }
                        break;
                    }
                }
            }
        }

            // 🆕 아무도 타겟되지 않았을 때 추가 검사 (🔧 수정: 일반적인 외침 제외)
    if (targetedBots.length === 0) {
        const suspicionKeywords = ['의심', '수상', '이상', '마피아', '거짓말'];
        const hasSuspicionKeyword = suspicionKeywords.some(keyword => message.includes(keyword));
        
        if (hasSuspicionKeyword) {
            // 🔧 **핵심 수정**: 일반적인 외침인지 먼저 확인 (이미 위에서 체크했지만 재확인)
            const isGeneralExclamation = this.isGeneralExclamation(message);
            const mentionedPlayerName = this.extractPlayerName(message, room);
            const isTargetingSpecificPlayer = this.isTargetingSpecificPlayer(message, room);
            
            console.log(`[타겟 감지 분석] 메시지: "${chatMessage.message}", 일반 외침: ${isGeneralExclamation}, 언급된 플레이어: "${mentionedPlayerName}", 특정 플레이어 타겟: ${isTargetingSpecificPlayer}`);
            
            // 일반적인 외침이 아니면서, 특정 플레이어를 지목하지 않는 의심 표현일 때만 봇들이 반응
            if (!isGeneralExclamation && !isTargetingSpecificPlayer && mentionedPlayerName === null) {
                // 30% 확률로 랜덤 봇이 반응 (너무 많은 반응 방지)
                if (Math.random() < 0.3) {
                    if (aliveBots.length > 0) {
                        const randomBot = aliveBots[Math.floor(Math.random() * aliveBots.length)];
                        targetedBots.push(randomBot);
                        console.log(`[타겟 감지] 의심 키워드로 랜덤 타겟: ${randomBot.name}`);
                    }
                }
            } else {
                if (isGeneralExclamation) {
                    console.log(`[타겟 감지 제외] 일반적인 외침이므로 봇 반응 생략`);
                } else if (isTargetingSpecificPlayer) {
                    console.log(`[타겟 감지 제외] 특정 플레이어 "${mentionedPlayerName}"를 지목하는 메시지이므로 봇 반응 생략`);
                }
            }
        }
    }

        console.log(`[타겟 감지 결과] 메시지: "${chatMessage.message}" → 타겟된 봇들: [${targetedBots.map(bot => bot.name).join(', ')}]`);
        return targetedBots;
    }

    // 🆕 플레이어의 실제 모순 발언 확인
    checkPlayerContradictions(roomCode, playerId) {
        const history = this.gameHistory.get(roomCode);
        if (!history || !history.playerStatements.has(playerId)) {
            return [];
        }

        const statements = history.playerStatements.get(playerId);
        const contradictions = [];

        // 1. 역할 주장 모순
        if (statements.roleClaims && statements.roleClaims.length > 1) {
            const uniqueRoles = new Set(statements.roleClaims.map(claim => claim.role));
            if (uniqueRoles.size > 1) {
                const rolesList = Array.from(uniqueRoles).join(', ');
                contradictions.push({
                    type: 'role_claim',
                    description: `여러 역할 주장: ${rolesList}`,
                    severity: 'high'
                });
            }
        }

        // 2. 의심/신뢰 모순
        if (statements.suspicionClaims && statements.trustClaims) {
            for (const suspicion of statements.suspicionClaims) {
                const laterTrust = statements.trustClaims.find(trust => 
                    trust.target === suspicion.target && 
                    trust.timestamp > suspicion.timestamp
                );
                if (laterTrust) {
                    contradictions.push({
                        type: 'trust_suspicion',
                        description: `${suspicion.target}을 의심했다가 신뢰한다고 함`,
                        severity: 'medium'
                    });
                }
            }
        }

        // 3. 정보 주장과 실제 기록 불일치 (경찰의 경우)
        if (statements.informationClaims && statements.informationClaims.length > 0) {
            const actualInvestigations = this.findPlayerInvestigations(playerId, history);
            const claimedInvestigations = statements.informationClaims.filter(claim => claim.type === 'investigation');
            
            if (claimedInvestigations.length > 0 && actualInvestigations.length === 0) {
                contradictions.push({
                    type: 'false_information',
                    description: '조사 결과를 주장하지만 실제 조사 기록이 없음',
                    severity: 'high'
                });
            }
        }

        return contradictions;
    }

    // 🆕 일반적인 외침이나 감탄사인지 판단
    isGeneralExclamation(message) {
        // 일반적인 외침 패턴들
        const exclamationPatterns = [
            /^마피아야!?$/,           // "마피아야", "마피아야!"
            /^거짓말!?$/,             // "거짓말", "거짓말!"
            /^의심스러워!?$/,         // "의심스러워", "의심스러워!"
            /^수상해!?$/,             // "수상해", "수상해!"
            /^이상해!?$/,             // "이상해", "이상해!"
            /^마피아다!?$/,           // "마피아다", "마피아다!"
            /^진짜\??$/,             // "진짜", "진짜?"
            /^아니야!?$/,             // "아니야", "아니야!"
            /^그래!?$/,               // "그래", "그래!"
            /^그런가\??$/,            // "그런가", "그런가?"
            /^맞아!?$/,               // "맞아", "맞아!"
            /^어?!?$/,                // "어", "어!"
            /^엥\??$/,                // "엥", "엥?"
            /^헉!?$/,                 // "헉", "헉!"
            /^어라\??$/,              // "어라", "어라?"
            /^잠깐!?$/,               // "잠깐", "잠깐!"
            /^아!?$/,                 // "아", "아!"
            /^오!?$/,                 // "오", "오!"
            /^우와!?$/,               // "우와", "우와!"
            /^대박!?$/,               // "대박", "대박!"
            /^진짜로\??$/,            // "진짜로", "진짜로?"
            /^마피아 찾자!?$/,        // "마피아 찾자", "마피아 찾자!"
            /^누가 마피아야\??$/,     // "누가 마피아야", "누가 마피아야?"
            /^마피아 어디있어\??$/,   // "마피아 어디있어", "마피아 어디있어?"
        ];

        // 짧은 메시지 (4글자 이하)이면서 키워드만 포함하는 경우
        if (message.length <= 4) {
            const shortExclamations = ['마피아', '거짓말', '의심', '수상', '이상'];
            return shortExclamations.some(word => message === word || message === word + '!');
        }

        // 패턴 매칭
        return exclamationPatterns.some(pattern => pattern.test(message.trim()));
    }

    // 🆕 특정 플레이어를 지목하는 메시지인지 판단
    isTargetingSpecificPlayer(message, room) {
        if (!room) return false;
        
        // 모든 플레이어 이름 목록 가져오기
        const allPlayerNames = [];
        for (const player of room.players.values()) {
            allPlayerNames.push(player.name.toLowerCase());
        }
        for (const bot of room.bots.values()) {
            allPlayerNames.push(bot.name.toLowerCase());
        }
        
        const lowerMessage = message.toLowerCase();
        
        // 플레이어 이름이 언급되었는지 확인
        const mentionedPlayerName = allPlayerNames.find(name => lowerMessage.includes(name));
        if (!mentionedPlayerName) {
            return false; // 플레이어 이름이 없으면 특정 지목이 아님
        }
        
        // 정규식 특수문자 이스케이프
        const escapedPlayerName = mentionedPlayerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // 특정 플레이어를 지목하는 패턴들
        const targetingPatterns = [
            // "A가 마피아다", "A는 마피아야" 형태
            new RegExp(`${escapedPlayerName}.{0,5}(가|는|이|을|를).{0,10}(마피아|의심|수상|이상|거짓말)`, 'i'),
            // "A 마피아", "A 의심스럽다" 형태  
            new RegExp(`${escapedPlayerName}.{0,5}(마피아|의심|수상|이상|거짓말)`, 'i'),
            // "마피아는 A다", "의심스러운 건 A야" 형태
            new RegExp(`(마피아|의심|수상|이상|거짓말).{0,10}(는|은|건).{0,10}${escapedPlayerName}`, 'i'),
            // "A 투표", "A한테 투표" 형태
            new RegExp(`${escapedPlayerName}.{0,10}(투표|뽑|선택)`, 'i'),
            // 직접적인 지목 패턴
            new RegExp(`${escapedPlayerName}.{0,5}(같|인|임|지|야|다|해|함)`, 'i')
        ];
        
        // 패턴 중 하나라도 매칭되면 특정 플레이어 지목으로 판단
        const isTargeting = targetingPatterns.some(pattern => pattern.test(lowerMessage));
        
        console.log(`[특정 플레이어 지목 분석] 플레이어: "${mentionedPlayerName}", 메시지: "${message}", 지목 여부: ${isTargeting}`);
        
        return isTargeting;
    }

    // 🆕 최근 봇 메시지 가져오기
    getRecentBotMessages(room, count = 5) {
        const history = this.gameHistory.get(room.code);
        if (!history) return [];
        
        return history.chatHistory
            .filter(msg => msg.type === 'player' && this.isBot(msg.playerId, room))
            .slice(-count)
            .reverse(); // 최신 메시지부터
    }

    // 🆕 반응형 응답 생성
    generateReactiveResponse(room, bot, originalMessage) {
            const message = originalMessage.message.toLowerCase();
            const senderName = originalMessage.playerName;
            
        // 역할별 방어 전략
        let response = null;
        switch (bot.role) {
            case 'mafia':
                response = this.generateMafiaDefense(room, bot, message, senderName);
                break;
            case 'police':
                response = this.generatePoliceDefense(room, bot, message, senderName);
                break;
            case 'doctor':
                response = this.generateDoctorDefense(room, bot, message, senderName);
                break;
            case 'citizen':
                response = this.generateCitizenDefense(room, bot, message, senderName);
                break;
            default:
                response = this.generateGenericDefense(bot, message, senderName);
                break;
        }
        
        // 🆕 응답 생성 실패 시 기본 응답 제공
        if (!response) {
            const defaultResponses = [
                `${senderName} 뭔 소리임?`,
                `아니 왜 나 의심함?`,
                `나 진짜 시민인뎅...`,
                `증거 있어서 그러는거임?`,
                `억울하네 진짜 ㅅㅂ`,
                `아 진짜 답답해`,
                `왜 나만 의심함 ㅗㅗ`,
                `말도 안되는 소리네`
            ];
            response = defaultResponses[Math.floor(Math.random() * defaultResponses.length)];
            console.log(`[기본 응답 사용] ${bot.name}: 역할별 응답 실패, 기본 응답 사용`);
        }
        
        return response;
    }

    // 🆕 마피아 봇 방어 응답 (디시인사이드 말투)
    generateMafiaDefense(room, bot, message, senderName) {
        const responses = [];
        
        if (message.includes('거짓말') || message.includes('마피아')) {
            // 화나고 억울한 말투 (디시인사이드 스타일)
            responses.push(`야 ${senderName} 뭔 소리임? 나 시민이라고!`);
            responses.push(`아니 증거도 없으면서 그렇게 말하면 어케함?`);
            responses.push(`진짜 미치겠네 ㅅㅂ... 나 진짜 시민임`);
            responses.push(`${senderName} 너가 더 의심스럽다고 ㅋㅋ`);
            responses.push(`아 진짜 억울하네, 나 정말 마피아 아님!`);
            responses.push(`어이없어... 나 시민인데 왜 이럼?`);
            responses.push(`말도 안됨, 난 마피아 찾으려고 개노력중이라고`);
            responses.push(`아니 나보고 마피아라고? 진짜?? 실화냐??`);
            responses.push(`${senderName} 개빡치게 하네 진짜 ㅗㅗ`);
        } else if (message.includes('의심') || message.includes('이상')) {
            // 방어적이지만 디시인사이드 말투
            responses.push(`나 왜 의심함? 뭘 잘못했는뎅?`);
            responses.push(`아 진짜... 나 시민이라니까 ㅇㅇ`);
            responses.push(`${senderName} 너 지금 뭐하는거임?`);
            responses.push(`시민끼리 왜 싸워... 마피아만 개좋아함`);
            responses.push(`이상한 건 너임 ㅋㅋㅋ`);
            responses.push(`아니 내가 뭘 어케 했다고...`);
        } else if (message.includes('설명') || message.includes('해명')) {
            // 짜증나는 말투
            responses.push(`뭘 설명하라는거임? 나 시민임!`);
            responses.push(`아니 설명할게 뭐가 있음?`);
            responses.push(`너부터 설명해봐 진짜`);
            responses.push(`할 말 없음, 그냥 나 시민임`);
            responses.push(`뭔 설명? 나 그냥 게임하고 있었는뎅?`);
        }
        
        return responses.length > 0 ? responses[Math.floor(Math.random() * responses.length)] : null;
    }

    // 🆕 경찰 봇 방어 응답 (디시인사이드 말투)
    generatePoliceDefense(room, bot, message, senderName) {
        const responses = [];
        
        if (message.includes('거짓말') || message.includes('마피아')) {
            // 확신에 차지만 화난 말투 (디시인사이드 스타일)
            responses.push(`야 나 경찰임! 조사결과 믿어 제발!`);
            responses.push(`${senderName} 진짜 미쳤음? 나 경찰이라고!`);
            responses.push(`마피아가 경찰 의심하게 만드는거 아님?`);
            responses.push(`아니 내 조사결과 봤지? 왜 날 의심함?`);
            responses.push(`진짜 어이없네... 경찰한테 뭐하는거임`);
            responses.push(`나 경찰임! 정신차려!`);
            responses.push(`아 진짜 답답해, 나 경찰이라니까 ㅅㅂ!`);
            responses.push(`조사결과 다시 봐봐! 나 경찰임!`);
            responses.push(`실화냐? 경찰 의심하는거 개이상함`);
        } else if (message.includes('의심')) {
            // 답답하고 짜증나는 말투
            responses.push(`나 경찰이라고 했잖음!`);
            responses.push(`경찰 의심하면 마피아만 개좋아함`);
            responses.push(`내 조사결과가 틀렸다는거임?`);
            responses.push(`아 진짜... 경찰을 왜 의심함?`);
            responses.push(`나 믿어야지, 경찰인뎅`);
            responses.push(`시민이면 경찰 편 들어야지!`);
        }
        
        return responses.length > 0 ? responses[Math.floor(Math.random() * responses.length)] : null;
    }

    // 🆕 의사 봇 방어 응답 (디시인사이드 말투)
    generateDoctorDefense(room, bot, message, senderName) {
        const responses = [];
        
        if (message.includes('거짓말') || message.includes('마피아')) {
            // 온화하지만 당황한 말투 (디시인사이드 스타일)
            responses.push(`나 의사임... 사람들 치료하고 있는뎅`);
            responses.push(`${senderName} 의사를 왜 의심함?`);
            responses.push(`아님, 나 시민 보호하는 역할이라고`);
            responses.push(`진짜? 나 의사인뎅... 믿어줘 제발`);
            responses.push(`어케 의사를 의심할 수가 있음?`);
            responses.push(`나 사람 살리는 일 하고 있음!`);
            responses.push(`아니 의사가 마피아라고? 말이 됨?`);
            responses.push(`의사 의심하면 누가 치료함 진짜`);
        } else if (message.includes('의심')) {
            // 착하지만 서운한 말투
            responses.push(`의사를 왜 의심함?`);
            responses.push(`나 모든 사람 살리려고 개노력하는뎅...`);
            responses.push(`아님, 나 의사임`);
            responses.push(`좀 믿어줘, 나 의사라고 ㅠㅠ`);
            responses.push(`왜 그럼? 나 나쁜 사람 아님`);
        }
        
        return responses.length > 0 ? responses[Math.floor(Math.random() * responses.length)] : null;
    }

    // 🆕 시민 봇 방어 응답 (디시인사이드 말투)
    generateCitizenDefense(room, bot, message, senderName) {
        const responses = [];
        
        if (message.includes('거짓말') || message.includes('마피아')) {
            // 억울하고 당황한 일반인 말투 (디시인사이드 스타일)
            responses.push(`나 시민임! 왜 날 의심함?`);
            responses.push(`${senderName} 증거가 있음?`);
            responses.push(`나도 마피아 찾고 있다고!`);
            responses.push(`시민끼리 싸우면 안되잖음`);
            responses.push(`아니 왜 나임? 나 시민이라고!`);
            responses.push(`진짜 어이없다... 나 마피아 아님`);
            responses.push(`아 진짜 억울해! 나 시민임!`);
            responses.push(`말도 안됨, 나 평범한 시민이라고`);
            responses.push(`${senderName}이 더 수상한뎅? ㅋㅋ`);
        } else if (message.includes('의심')) {
            // 방어적이고 디시인사이드 말투
            responses.push(`뭐가 의심스러운뎅?`);
            responses.push(`내가 뭘 잘못했음?`);
            responses.push(`${senderName} 너가 더 의심스럽다`);
            responses.push(`아니 왜 날 의심함?`);
            responses.push(`나 그냥 게임하고 있었는뎅...`);
            responses.push(`억울하네 진짜 ㅅㅂ`);
        }
        
        return responses.length > 0 ? responses[Math.floor(Math.random() * responses.length)] : null;
    }

    // 🆕 일반적인 방어 응답 (디시인사이드 말투)
    generateGenericDefense(bot, message, senderName) {
        const responses = [
            `${senderName} 왜 그렇게 생각함?`,
            `나 아무 잘못한거 없는뎅?`,
            `근거 없이 의심하지 마라`,
            `다같이 마피아 찾아야지 진짜`,
            `아니 왜 날 의심함?`,
            `억울하네 진짜 ㅅㅂ`,
            `나 진짜 아무것도 안했음`,
            `뭔 소리임?`,
            `개어이없네`
        ];
        
        return responses[Math.floor(Math.random() * responses.length)];
    }

        // 🆕 일반적인 반응 생성 (타겟되지 않은 경우, 디시인사이드 말투)
    generateGeneralResponse(room, bot, originalMessage) {
        const message = originalMessage.message.toLowerCase();
        const senderName = originalMessage.playerName;
        
        // 🆕 "누가 마피아냐?" 질문에 대한 경찰/가짜경찰 우선 응답
        if (this.isAskingWhoIsMafia(message)) {
            console.log(`[마피아 질문 감지] ${bot.name} (${bot.role}): "${originalMessage.message}" 질문 감지`);
            
            // 경찰이나 가짜 경찰이 우선적으로 답변
            if (bot.role === 'police' || this.isFakePoliceBot(room.code, bot.id)) {
                const investigationAnswer = this.generateInvestigationAnswer(room, bot);
                if (investigationAnswer) {
                    console.log(`[마피아 질문 답변] ${bot.name}: 조사 결과 기반 답변`);
                    return investigationAnswer;
                }
            }
            
            // 다른 역할의 봇들도 추측으로 답변 (30% 확률)
            if (Math.random() < 0.3) {
                const guessAnswer = this.generateMafiaGuess(room, bot);
                if (guessAnswer) {
                    console.log(`[마피아 질문 답변] ${bot.name}: 추측 기반 답변`);
                    return guessAnswer;
                }
            }
        }
        
        // 특정 키워드에 대한 일반적인 반응
        if (message.includes('마피아를 찾')) {
            const responses = ['ㅇㅇ, 같이 찾아보자', '맞음 마피아 찾아야함', '그래 다같이 찾자고'];
            return responses[Math.floor(Math.random() * responses.length)];
        } else if (message.includes('투표')) {
            const responses = ['신중하게 투표해야함 ㅇㅇ', '누구 투표할까?', '잘 생각해서 투표하자고'];
            return responses[Math.floor(Math.random() * responses.length)];
        } else if (message.includes('의심')) {
            const responses = ['누구 의심함?', '왜 의심스러워?', '뭔가 이상한뎅?'];
            return responses[Math.floor(Math.random() * responses.length)];
        } else if (message.includes('경찰') || message.includes('조사')) {
            const responses = ['경찰 조사결과 개중요함', '경찰 믿어야지', '조사결과 어케 나왔음?'];
            return responses[Math.floor(Math.random() * responses.length)];
        } else if (message.includes('증거')) {
            const responses = ['증거 있어야 확신할 수 있지', '무슨 증거 있음?', '증거 개중요해'];
            return responses[Math.floor(Math.random() * responses.length)];
        }
        
        // 20% 확률로만 응답 (너무 많은 반응 방지)
        const casualResponses = [
            '그런가?', '음... 그렇네', '맞는것 같음', '그런가봄', 
            '어케 생각함?', '흠...', '그럴 수도 있지', '모르겠음',
            'ㅇㅇ', 'ㄴㄴ', '그런뎅?', '개궁금하네'
        ];
        return Math.random() < 0.2 ? casualResponses[Math.floor(Math.random() * casualResponses.length)] : null;
    }

    // 🆕 "누가 마피아냐?" 질문인지 감지
    isAskingWhoIsMafia(message) {
        console.log(`[마피아 질문 감지 시도] 메시지: "${message}"`);
        
        const mafiaQuestionPatterns = [
            // 한글 패턴
            /누가.*마피아/,
            /마피아.*누구/,
            /마피아가.*누구/,
            /누가.*마피아야/,
            /마피아.*누군가/,
            /마피아는.*누구/,
            /마피아.*어디/,
            /어디.*마피아/,
            /마피아.*찾/,
            /찾.*마피아/,
            /마피아.*알려/,
            /알려.*마피아/,
            /마피아.*말해/,
            /말해.*마피아/,
            // 단순 패턴
            /누가 마피아/,
            /마피아 누구/,
            /누구 마피아/,
            /마피아야/,
            /마피아냐/,
            // 영어 테스트 패턴  
            /who.*mafia/,
            /mafia.*who/,
            /who is mafia/
        ];
        
        const isMatch = mafiaQuestionPatterns.some(pattern => {
            const match = pattern.test(message);
            if (match) {
                console.log(`[마피아 질문 매칭] 패턴 "${pattern}" 매칭됨!`);
            }
            return match;
        });
        
        console.log(`[마피아 질문 감지 결과] "${message}" → ${isMatch}`);
        return isMatch;
    }

    // 🆕 조사 결과 기반 답변 생성
    generateInvestigationAnswer(room, bot) {
        const history = this.gameHistory.get(room.code);
        if (!history) return null;

        // 🔍 진짜 경찰의 경우 - 실제 조사 결과 확인
        if (bot.role === 'police') {
            let investigationsToCheck = [];
            
            // 현재 라운드 조사 결과 확인
            if (history.currentRound && history.currentRound.investigations && history.currentRound.investigations.length > 0) {
                investigationsToCheck = history.currentRound.investigations;
            }
            // 마지막 완료된 라운드에서 확인
            else if (history.rounds.length > 0) {
                const lastRound = history.rounds[history.rounds.length - 1];
                if (lastRound.investigations && lastRound.investigations.length > 0) {
                    investigationsToCheck = lastRound.investigations;
                }
            }
            
            // 자신의 조사 결과가 있으면 발표
            for (const investigation of investigationsToCheck) {
                if (investigation.investigator === bot.id) {
                    const targetName = this.getPlayerName(investigation.target, room);
                    if (investigation.result === 'mafia') {
                        const mafiaAnswers = [
                            `${targetName}이 마피아야! 내가 조사했어!`,
                            `${targetName} 마피아 확실해! 조사결과임!`,
                            `내가 경찰인데 ${targetName} 마피아라고!`,
                            `${targetName}! 조사해보니 마피아였어!`,
                            `${targetName} 마피아임! 경찰 조사결과야!`
                        ];
                        return mafiaAnswers[Math.floor(Math.random() * mafiaAnswers.length)];
                    } else {
                        const innocentAnswers = [
                            `${targetName}은 시민이야, 조사했어`,
                            `${targetName} 마피아 아님! 조사결과야`,
                            `내가 조사한 ${targetName}은 무고해`,
                            `${targetName} 시민 확정! 경찰 보장!`,
                            `${targetName}은 믿어도 돼, 시민이야`
                        ];
                        return innocentAnswers[Math.floor(Math.random() * innocentAnswers.length)];
                    }
                }
            }
        }

        // 🎭 가짜 경찰의 경우 - 거짓 조사 결과 확인
        if (this.isFakePoliceBot(room.code, bot.id)) {
            const fakeInvestigations = this.fakeInvestigations.get(room.code) || [];
            
            // 발표할 거짓 조사 결과가 있는지 확인
            for (const fakeInv of fakeInvestigations) {
                if (fakeInv.investigator === bot.id) {
                    if (fakeInv.result === 'mafia') {
                        const fakeMafiaAnswers = [
                            `${fakeInv.targetName}이 마피아야! 내가 조사했어!`,
                            `${fakeInv.targetName} 마피아 확실해! 조사결과임!`,
                            `내가 경찰인데 ${fakeInv.targetName} 마피아라고!`,
                            `${fakeInv.targetName}! 조사해보니 마피아였어!`,
                            `${fakeInv.targetName} 마피아임! 경찰 조사결과야!`
                        ];
                        console.log(`[거짓 조사 발표] ${bot.name}: ${fakeInv.targetName}을 마피아로 거짓 발표`);
                        return fakeMafiaAnswers[Math.floor(Math.random() * fakeMafiaAnswers.length)];
                    } else {
                        const fakeInnocentAnswers = [
                            `${fakeInv.targetName}은 시민이야, 조사했어`,
                            `${fakeInv.targetName} 마피아 아님! 조사결과야`,
                            `내가 조사한 ${fakeInv.targetName}은 무고해`,
                            `${fakeInv.targetName} 시민 확정! 경찰 보장!`,
                            `${fakeInv.targetName}은 믿어도 돼, 시민이야`
                        ];
                        console.log(`[거짓 조사 발표] ${bot.name}: ${fakeInv.targetName}을 시민으로 거짓 발표`);
                        return fakeInnocentAnswers[Math.floor(Math.random() * fakeInnocentAnswers.length)];
                    }
                }
            }
            
            // 거짓 조사 결과가 없으면 경찰 주장과 함께 준비중이라고 답변
            const preparingAnswers = [
                `나 경찰인데 아직 조사중이야`,
                `경찰로서 조사하고 있어, 곧 알려줄게`,
                `내가 경찰이니까 기다려봐`,
                `조사 결과 나오면 바로 알려줄게`,
                `경찰인 내가 확인하고 있어`
            ];
            return preparingAnswers[Math.floor(Math.random() * preparingAnswers.length)];
        }

        return null;
    }

    // 🆕 추측 기반 마피아 지목 답변 생성
    generateMafiaGuess(room, bot) {
        const history = this.gameHistory.get(room.code);
        if (!history) return null;

        const alivePlayers = this.getAlivePlayers(room).filter(p => p.id !== bot.id);
        const suspiciousPlayers = this.getMostSuspiciousPlayers(history, alivePlayers);
        
        // 🚨 마피아 봇의 경우 동료 마피아는 제외하고 시민을 지목
        let targetsToMention = [];
        if (bot.role === 'mafia') {
            targetsToMention = alivePlayers.filter(p => p.role !== 'mafia');
        } else {
            targetsToMention = alivePlayers;
        }
        
        // 채팅한 플레이어 중에서 선택
        const chattedTargets = this.filterPlayersWhoChatted(room.code, targetsToMention.map(p => ({ player: p })));
        
        if (chattedTargets.length > 0) {
            const randomTarget = chattedTargets[Math.floor(Math.random() * chattedTargets.length)];
            const targetName = randomTarget.player.name;
            
            const guessAnswers = [
                `${targetName} 의심스러워 보이는뎅?`,
                `내 생각엔 ${targetName}이 마피아 같아`,
                `${targetName} 행동이 좀 이상한 것 같은데`,
                `${targetName} 마피아 아닐까? 느낌상`,
                `잘 모르겠지만 ${targetName} 의심됨`,
                `${targetName} 좀 수상해 보이지 않아?`
            ];
            return guessAnswers[Math.floor(Math.random() * guessAnswers.length)];
        }
        
        // 채팅한 플레이어가 없으면 일반적인 답변
        const generalAnswers = [
            `아직 확실하지 않아, 더 지켜봐야겠어`,
            `좀 더 관찰해봐야 알 것 같아`,
            `아직 모르겠어, 증거가 더 필요해`,
            `확실한 증거 없으면 말하기 어려워`,
            `지금은 모르겠어, 더 생각해봐야지`
        ];
        return generalAnswers[Math.floor(Math.random() * generalAnswers.length)];
    }
}

// 게임 상태 관리
class MafiaGame {
    constructor() {
        this.rooms = new Map();
        this.players = new Map(); // socketId -> player info
        this.sessions = new Map(); // sessionId -> socketId (현재 연결된 세션)
        this.botAI = new BotAI(); // 봇 AI 시스템
        this.lobbyPlayers = new Set(); // 로비에 있는 플레이어들 (socketId)
        
        // 도배 방지 시스템
        this.chatHistory = new Map(); // playerId -> [timestamps]
        this.chatBans = new Map(); // playerId -> banEndTime
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
        
        // 🚨 **추가**: 방에 들어가면 로비에서 제거
        this.lobbyPlayers.delete(hostSocketId);
        console.log(`[로비 제거] ${hostSocketId} 방 생성으로 제거됨. 현재 로비 인원: ${this.lobbyPlayers.size}`);

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
        
        // 🚨 **추가**: 방에 들어가면 로비에서 제거
        this.lobbyPlayers.delete(socketId);
        console.log(`[로비 제거] ${socketId} 방 참가로 제거됨. 현재 로비 인원: ${this.lobbyPlayers.size}`);

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

    removeBot(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room || room.gameStarted) {
            return null;
        }

        if (room.bots.size === 0) {
            return { error: 'no_bots' };
        }

        // 가장 마지막에 추가된 봇을 제거
        const botEntries = Array.from(room.bots.entries());
        const [lastBotId, lastBot] = botEntries[botEntries.length - 1];
        
        room.bots.delete(lastBotId);
        return { removedBot: lastBot };
    }

    removePlayer(socketId) {
        const playerInfo = this.players.get(socketId);
        if (!playerInfo) {
            // 방에 속하지 않은 플레이어가 연결 해제된 경우 (로비에 있던 플레이어)
            this.lobbyPlayers.delete(socketId);
            return null;
        }

        // 세션 맵 정리
        if (playerInfo.sessionId) {
            this.sessions.delete(playerInfo.sessionId);
        }

        const room = this.rooms.get(playerInfo.roomCode);
        if (!room) {
            this.players.delete(socketId);
            this.lobbyPlayers.delete(socketId);
            return null;
        }

        room.players.delete(socketId);
        this.players.delete(socketId);
        
        // 🚨 **수정**: 방에서 나간 플레이어는 로비로 돌아가야 하지만,
        // disconnect 이벤트에서 호출되는 경우는 완전히 연결 해제되므로 로비에 추가하지 않음
        // 이 메소드는 disconnect 시에만 호출되므로 로비에 추가하지 않음
        this.lobbyPlayers.delete(socketId);

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

        console.log(`🚨🚨🚨 [GAME START] 방 ${roomCode} 게임 시작! 총 ${totalPlayers}명`);

        // 역할 배정
        this.assignRoles(room);
        
        console.log(`🚨🚨🚨 [AFTER ASSIGN] 역할 배정 완료, 가짜 경찰 확인:`, this.botAI.fakePoliceBots.get(roomCode));
        
        room.gameStarted = true;
        room.gameState = 'night';
        room.round = 1;

        // 🔄 봇 지능 시스템 완전 초기화
        console.log(`[게임 시작] ${roomCode}: 봇 지능 시스템 초기화`);
        this.botAI.resetBotIntelligence(roomCode);

        console.log(`🚨🚨🚨 [AFTER RESET] 리셋 후 가짜 경찰 확인:`, this.botAI.fakePoliceBots.get(roomCode));

        return room;
    }

    assignRoles(room) {
        const allPlayers = [...room.players.values(), ...room.bots.values()];
        const totalPlayers = allPlayers.length;
        
        console.log(`=== 역할 배정 시작 (총 ${totalPlayers}명) ===`);
        
        // 필수 직업들과 선택적 직업들 구분
        const mandatoryRoles = ['police', 'doctor']; // 반드시 포함되어야 하는 직업
        const optionalRoles = ['wizard', 'joker', 'shaman', 'politician']; // 랜덤 선택 직업
        
        // 역할 배정 계산
        let baseMafiaCount = Math.floor(totalPlayers / 3);
        let citizenSlots = totalPlayers - baseMafiaCount;
        
        // 시민팀이 최소 3명은 되어야 함 (경찰+의사+최소1명)
        const minCitizenSlots = mandatoryRoles.length + 1; // 최소 3명
        if (citizenSlots < minCitizenSlots) {
            const deficit = minCitizenSlots - citizenSlots;
            baseMafiaCount = Math.max(1, baseMafiaCount - deficit); // 마피아는 최소 1명
            citizenSlots = totalPlayers - baseMafiaCount;
            console.log(`⚖️ 최소 시민팀 보장: 마피아 ${deficit}명 감소`);
        }
        
        console.log(`🎭 최종 구성: 마피아 ${baseMafiaCount}명, 시민팀 특수직업 ${citizenSlots}명`);
        
        const roles = [];
        
        // 마피아 추가
        for (let i = 0; i < baseMafiaCount; i++) {
            roles.push('mafia');
        }
        
        // 1. 필수 직업들 먼저 배정
        const citizenRoles = [...mandatoryRoles];
        console.log(`🔒 필수 직업 배정: ${mandatoryRoles.join(', ')}`);
        
        // 2. 남은 자리에 선택적 직업들 랜덤 배정
        const remainingSlots = citizenSlots - mandatoryRoles.length;
        if (remainingSlots > 0) {
            const shuffledOptionalRoles = [...optionalRoles];
            // 선택적 직업들 섞기
            for (let i = shuffledOptionalRoles.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffledOptionalRoles[i], shuffledOptionalRoles[j]] = [shuffledOptionalRoles[j], shuffledOptionalRoles[i]];
            }
            
            // 필요한 만큼만 추가
            const selectedOptionalRoles = shuffledOptionalRoles.slice(0, remainingSlots);
            citizenRoles.push(...selectedOptionalRoles);
            console.log(`🎲 선택적 직업 배정: ${selectedOptionalRoles.join(', ')}`);
        }
        
        // 시민팀 직업들을 전체적으로 섞기
        for (let i = citizenRoles.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [citizenRoles[i], citizenRoles[j]] = [citizenRoles[j], citizenRoles[i]];
        }
        
        // 최종 역할 배열에 추가
        roles.push(...citizenRoles);
        
        // 배정된 직업 통계 출력
        const roleCount = {};
        roles.forEach(role => {
            roleCount[role] = (roleCount[role] || 0) + 1;
        });
        
        console.log('📊 직업 배정 통계:');
        Object.entries(roleCount).forEach(([role, count]) => {
            const roleNames = {
                'mafia': '마피아',
                'doctor': '의사', 
                'police': '경찰',
                'wizard': '마법사',
                'joker': '조커',
                'shaman': '무당',
                'politician': '정치인'
            };
            console.log(`  - ${roleNames[role]}: ${count}명`);
        });
        
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
        
        // 🎭 마피아 봇 중 경찰 연기자 선택
        console.log(`[DEBUG] assignRoles에서 가짜 경찰 선택 시도 중...`);
        console.log(`[DEBUG] 현재 봇 목록:`, Array.from(room.bots.values()).map(bot => ({ name: bot.name, role: bot.role, alive: bot.alive })));
        this.botAI.selectFakePoliceBot(room);
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
            spiritInvestigated: null,
            roleSwapped: null
        };

        // 마법사의 능력 처리 (다른 행동보다 먼저 처리)
        for (const [playerId, action] of room.nightActions) {
            if (action.type === 'swap') {
                const wizard = room.players.get(playerId) || room.bots.get(playerId);
                const target = room.players.get(action.target) || room.bots.get(action.target);
                
                if (wizard && target) {
                    // 역할 교환 항상 성공
                    const wizardRole = wizard.role;
                    const targetRole = target.role;
                    
                    // 직업 교환
                    wizard.role = targetRole;
                    target.role = 'citizen';
                    
                    results.roleSwapped = {
                        wizard: playerId,
                        target: action.target,
                        wizardNewRole: targetRole,
                        targetNewRole: 'citizen',
                        success: true
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
                // 조커 특수 능력 처리
                const target = room.players.get(targetToKill) || room.bots.get(targetToKill);
                if (target && target.role === 'joker') {
                    console.log(`🃏 조커 ${target.name}이 마피아에게 공격받음! 반격 발동!`);
                    
                    // 살아있는 마피아들 찾기
                    const aliveMafias = [];
                    for (const player of room.players.values()) {
                        if (player.role === 'mafia' && player.alive) {
                            aliveMafias.push(player);
                        }
                    }
                    for (const bot of room.bots.values()) {
                        if (bot.role === 'mafia' && bot.alive) {
                            aliveMafias.push(bot);
                        }
                    }
                    
                    if (aliveMafias.length > 0) {
                        // 랜덤으로 마피아 1명 선택해서 죽이기
                        const randomMafia = aliveMafias[Math.floor(Math.random() * aliveMafias.length)];
                        
                        // 마피아의 직업을 시민으로 바꾼 후 죽이기
                        randomMafia.role = 'citizen';
                        
                        // 죽은 마피아에게 시민 역할 정보 전송 (실제 플레이어인 경우만)
                        if (room.players.has(randomMafia.id)) {
                            io.to(randomMafia.id).emit('roleAssigned', {
                                role: 'citizen',
                                gameStarted: true,
                                mafiaTeam: null // 시민이므로 마피아팀 정보 없음
                            });
                            console.log(`죽은 마피아 ${randomMafia.name}에게 시민 역할 정보 전송`);
                        }
                        
                        this.killPlayer(room, randomMafia.id);
                        
                        // 조커를 마피아로 전환
                        target.role = 'mafia';
                        
                        results.jokerRevenge = {
                            joker: targetToKill,
                            killedMafia: randomMafia.id,
                            killedMafiaOriginalRole: 'mafia', // 원래 직업 기록
                            jokerBecameMafia: true
                        };
                        
                        console.log(`🃏 조커가 마피아 ${randomMafia.name}을 죽이고 자신이 마피아가 됨! (죽은 마피아는 시민으로 처리)`);
                        
                        // 조커가 마피아로 전환됐으므로 마피아 팀 정보 업데이트
                        const newMafiaTeam = [];
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
                        
                        // 모든 마피아들에게 새로운 팀 정보 전송
                        for (const p of room.players.values()) {
                            if (p.role === 'mafia') {
                                io.to(p.id).emit('roleAssigned', {
                                    role: 'mafia',
                                    gameStarted: true,
                                    mafiaTeam: newMafiaTeam
                                });
                            }
                        }
                        console.log(`🃏 조커 ${target.name}을 포함한 새로운 마피아 팀 정보 전송 완료`);
                    }
                } else {
                    // 일반적인 죽음 처리
                    results.killed = targetToKill;
                    this.killPlayer(room, targetToKill);
                }
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

        // 무당의 죽은 사람 직업 조사 처리
        for (const [playerId, action] of room.nightActions) {
            if (action.type === 'spirit_investigate') {
                const deadPlayer = room.players.get(action.target) || room.bots.get(action.target);
                if (deadPlayer && !deadPlayer.alive) {
                    results.spiritInvestigated = {
                        investigator: playerId,
                        target: action.target,
                        targetRole: deadPlayer.role
                    };
                    console.log(`무당 ${playerId}이 죽은 플레이어 ${action.target}의 직업을 조사: ${deadPlayer.role}`);
                }
                break;
            }
        }

        // 봇 AI 히스토리 업데이트 (밤 결과)
        const nightData = {
            nightDeaths: results.killed ? [results.killed] : [],
            investigations: results.investigated ? [results.investigated] : [],
            spiritInvestigations: results.spiritInvestigated ? [results.spiritInvestigated] : [],
            roleSwaps: results.roleSwapped ? [results.roleSwapped] : []
        };
        
        // 현재 라운드 히스토리에 밤 결과 추가
        const history = this.botAI.gameHistory.get(room.code);
        if (history) {
            history.currentRound.nightActions = Object.fromEntries(room.nightActions);
            history.currentRound.deaths = nightData.nightDeaths;
            history.currentRound.investigations = nightData.investigations;
            history.currentRound.spiritInvestigations = nightData.spiritInvestigations;
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
        
        // 🔄 **중요**: 모든 봇의 선택을 먼저 결정 (동시 진행)
        const botDecisions = [];
        
        for (const bot of bots) {
            let target = null;
            let actionType = null;
            
            if (bot.role === 'mafia') {
                // 마피아 봇: AI 전략 사용
                target = this.botAI.chooseMafiaTarget(room, bot);
                actionType = 'kill';
                if (target) {
                    console.log(`마피아 봇 ${bot.name}이 ${target.name}을 공격 선택`);
                } else {
                    console.log(`마피아 봇 ${bot.name}: 공격할 대상이 없음`);
                }
            } else if (bot.role === 'doctor') {
                // 의사 봇: AI 전략 사용
                target = this.botAI.chooseDoctorTarget(room, bot);
                actionType = 'save';
                if (target) {
                    console.log(`의사 봇 ${bot.name}이 ${target.name}을 치료 선택`);
                } else {
                    console.log(`의사 봇 ${bot.name}: 치료할 대상이 없음`);
                }
            } else if (bot.role === 'police') {
                // 경찰 봇: AI 전략 사용
                target = this.botAI.choosePoliceTarget(room, bot);
                actionType = 'investigate';
                if (target) {
                    console.log(`경찰 봇 ${bot.name}이 ${target.name}을 수사 선택`);
                } else {
                    console.log(`경찰 봇 ${bot.name}: 수사할 대상이 없음`);
                }
            } else if (bot.role === 'wizard') {
                // 마법사 봇: AI 전략 사용
                target = this.botAI.chooseWizardTarget(room, bot);
                actionType = 'swap';
                if (target) {
                    console.log(`마법사 봇 ${bot.name}이 ${target.name}과 직업 교환 선택`);
                } else {
                    console.log(`마법사 봇 ${bot.name}: 교환할 대상이 없음`);
                }
            } else if (bot.role === 'shaman') {
                // 무당 봇: 죽은 플레이어 조사
                target = this.botAI.chooseShamanTarget(room, bot);
                actionType = 'spirit_investigate';
                if (target) {
                    console.log(`무당 봇 ${bot.name}이 죽은 플레이어 ${target.name}의 직업 조사 선택`);
                } else {
                    console.log(`무당 봇 ${bot.name}: 조사할 죽은 플레이어가 없음`);
                }
            }
            
            // 결정 사항 저장
            if (target && actionType) {
                botDecisions.push({
                    botId: bot.id,
                    actionType: actionType,
                    targetId: target.id
                });
            }
        }
        
        // 🔄 **중요**: 모든 결정이 완료된 후 한번에 nightActions에 저장
        console.log(`[동시 행동 처리] ${botDecisions.length}개의 봇 행동을 동시에 등록합니다.`);
        for (const decision of botDecisions) {
            room.nightActions.set(decision.botId, { 
                type: decision.actionType, 
                target: decision.targetId, 
                time: Date.now() 
            });
        }
        
        // 🎭 가짜 경찰 봇의 거짓 조사 실행
        const fakePoliceBotId = this.botAI.fakePoliceBots.get(room.code);
        if (fakePoliceBotId) {
            const fakePoliceBot = room.bots.get(fakePoliceBotId);
            if (fakePoliceBot && fakePoliceBot.alive && fakePoliceBot.role === 'mafia') {
                console.log(`[가짜 경찰 액션] ${fakePoliceBot.name}이 거짓 조사를 실행합니다.`);
                const fakeInvestigation = this.botAI.generateFakeInvestigation(room, fakePoliceBotId);
                if (fakeInvestigation) {
                    console.log(`[가짜 경찰 액션] ${fakePoliceBot.name}: ${fakeInvestigation.targetName} → ${fakeInvestigation.result} (거짓 조사 완료)`);
                } else {
                    console.log(`[가짜 경찰 액션] ${fakePoliceBot.name}: 더 이상 조사할 대상이 없습니다.`);
                }
            } else {
                console.log(`[가짜 경찰 액션] 가짜 경찰 봇이 죽었거나 존재하지 않습니다.`);
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
            } else {
                // 모든 시민팀 특수 직업 봇: 시민 전략 사용
                // (doctor, police, wizard, joker, shaman, politician)
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
        
        // 조커 특수 처리: 조커가 마피아로 전환되지 않았다면 시민팀으로 카운트
        const aliveJokers = alivePlayers.filter(p => p.role === 'joker');
        const aliveCitizens = alivePlayers.filter(p => p.role !== 'mafia');
        
        // 조커는 시민팀으로 카운트됨 (마피아로 전환되지 않은 경우)
        const totalCitizens = aliveCitizens.length; // 조커도 이미 포함됨 (role이 'joker'이므로 mafia가 아님)

        if (aliveMafia.length === 0) {
            return { ended: true, winner: 'citizens' };
        }

        if (aliveMafia.length >= totalCitizens) {
            return { ended: true, winner: 'mafia' };
        }

        return { ended: false };
    }

    processVoting(room) {
        const voteCounts = new Map();
        
        for (const [voter, target] of room.votes) {
            const count = voteCounts.get(target) || 0;
            
            // 투표자의 역할 확인
            const voterPlayer = room.players.get(voter) || room.bots.get(voter);
            let voteWeight = 1; // 기본 투표 가중치
            
            // 정치인은 1.5표의 가중치를 가짐
            if (voterPlayer && voterPlayer.role === 'politician') {
                voteWeight = 1.5;
                console.log(`[정치인 투표] ${voterPlayer.name}: 1.5표 가중치 적용`);
            }
            
            voteCounts.set(target, count + voteWeight);
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

        // 봇 AI 히스토리 업데이트 (현재 라운드의 밤 결과도 포함)
        const eliminatedPlayer = eliminated ? (room.players.get(eliminated) || room.bots.get(eliminated)) : null;
        const history = this.botAI.gameHistory.get(room.code);
        const roundData = {
            votes: Object.fromEntries(room.votes),
            eliminated: eliminatedPlayer ? { id: eliminated, role: eliminatedPlayer.role } : null,
            voteCounts: Object.fromEntries(voteCounts),
            // 현재 라운드의 밤 결과도 포함하여 완료된 라운드로 저장
            nightDeaths: history && history.currentRound ? (history.currentRound.deaths || []) : [],
            investigations: history && history.currentRound ? (history.currentRound.investigations || []) : [],
            spiritInvestigations: history && history.currentRound ? (history.currentRound.spiritInvestigations || []) : [],
            roleSwaps: history && history.currentRound ? (history.currentRound.roleSwaps || []) : []
        };
        
        this.botAI.updateRoundHistory(room, roundData);
        console.log(`[AI 히스토리] 라운드 ${room.round} 투표 결과 업데이트 (밤 결과 포함):`, roundData);

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
            const totalPlayers = room.players.size + room.bots.size;
            const hostPlayer = room.players.get(room.host);
            
            // 게임 상태 정보
            const gameStatus = room.gameStarted ? '플레이중' : '대기중';
            const canJoin = !room.gameStarted && totalPlayers < room.maxPlayers;
            
            publicRooms.push({
                roomCode: roomCode,
                hostName: hostPlayer ? hostPlayer.name : '호스트',
                currentPlayers: totalPlayers,
                maxPlayers: room.maxPlayers,
                gameStatus: gameStatus,
                gameStarted: room.gameStarted,
                canJoin: canJoin
            });
        }
        
        // 🚨 **수정**: 로비 플레이어 Set의 크기를 직접 반환
        const lobbyPlayersCount = this.lobbyPlayers.size;
        
        console.log(`[로비 계산] 로비 플레이어 수: ${lobbyPlayersCount}, 방 안 플레이어 수: ${this.players.size}`);
        
        return {
            rooms: publicRooms,
            totalWaitingPlayers: lobbyPlayersCount
        };
    }

    // 도배 방지 시스템
    isPlayerBanned(playerId) {
        const banEndTime = this.chatBans.get(playerId);
        if (!banEndTime) return false;
        
        const now = Date.now();
        if (now >= banEndTime) {
            this.chatBans.delete(playerId);
            return false;
        }
        
        return true;
    }

    checkSpamAndBan(playerId) {
        const now = Date.now();
        const threeSecondsAgo = now - 3000; // 3초 전
        
        // 플레이어의 채팅 히스토리 가져오기
        let history = this.chatHistory.get(playerId);
        if (!history) {
            history = [];
            this.chatHistory.set(playerId, history);
        }
        
        // 3초 이전 메시지들 제거
        const recentMessages = history.filter(timestamp => timestamp > threeSecondsAgo);
        this.chatHistory.set(playerId, recentMessages);
        
        // 새 메시지 추가
        recentMessages.push(now);
        
        // 3초 내에 5번 이상 메시지를 보냈는지 확인
        if (recentMessages.length >= 5) {
            // 10초간 채팅 금지
            const banEndTime = now + 10000; // 10초 후
            this.chatBans.set(playerId, banEndTime);
            console.log(`[도배 방지] 플레이어 ${playerId} 채팅 금지 (10초간)`);
            return true;
        }
        
        return false;
    }

    getRemainingBanTime(playerId) {
        const banEndTime = this.chatBans.get(playerId);
        if (!banEndTime) return 0;
        
        const remaining = Math.max(0, banEndTime - Date.now());
        return Math.ceil(remaining / 1000); // 초 단위로 반환
    }
}

const game = new MafiaGame();

// Socket.IO 연결 처리
io.on('connection', (socket) => {
    console.log('새 플레이어 연결:', socket.id);
    
    // 🚨 **추가**: 새 플레이어를 로비에 추가
    game.lobbyPlayers.add(socket.id);
    console.log(`[로비 추가] ${socket.id} 추가됨. 현재 로비 인원: ${game.lobbyPlayers.size}`);
    
    // 로비 인원 수 변경 알림
    io.emit('roomListUpdate');

    // 방 목록 요청
    socket.on('getRoomList', () => {
        const roomListData = game.getRoomList();
        socket.emit('roomList', roomListData);
    });

    // 방 생성
    socket.on('createRoom', (data) => {
        // 🚨 방어 코드: data 검증
        if (!data || typeof data !== 'object') {
            console.log(`[createRoom 오류] ${socket.id}: data가 undefined 또는 잘못된 형식`);
            socket.emit('joinError', { message: '잘못된 요청입니다.' });
            return;
        }
        
        const { playerName, sessionId } = data;
        if (!playerName || !sessionId) {
            console.log(`[createRoom 오류] ${socket.id}: playerName 또는 sessionId가 없음`);
            socket.emit('joinError', { message: '플레이어 이름과 세션 정보가 필요합니다.' });
            return;
        }
        
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
        // 🚨 방어 코드: data 검증
        if (!data || typeof data !== 'object') {
            console.log(`[joinRoom 오류] ${socket.id}: data가 undefined 또는 잘못된 형식`);
            socket.emit('joinError', { message: '잘못된 요청입니다.' });
            return;
        }
        
        const { roomCode, playerName, sessionId } = data;
        if (!roomCode || !playerName || !sessionId) {
            console.log(`[joinRoom 오류] ${socket.id}: 필수 정보가 없음`);
            socket.emit('joinError', { message: '방 코드, 플레이어 이름, 세션 정보가 모두 필요합니다.' });
            return;
        }
        
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
        
        // 🚨 방어 코드: data가 undefined이거나 botName이 없는 경우 처리
        if (!data || typeof data !== 'object') {
            console.log(`[addBot 오류] ${socket.id}: data가 undefined 또는 잘못된 형식`);
            return;
        }
        
        const { botName } = data;
        if (!botName || typeof botName !== 'string') {
            console.log(`[addBot 오류] ${socket.id}: botName이 없거나 잘못된 형식`);
            return;
        }
        
        console.log(`[봇 추가 시도] ${socket.id}가 ${botName} 봇 추가 시도. 현재 로비 인원: ${game.lobbyPlayers.size}`);
        const result = game.addBot(playerInfo.roomCode, botName);
        
        if (result && !result.error) {
            console.log(`[봇 추가 성공] ${botName} 봇 추가 완료. 로비 인원 변화 없음: ${game.lobbyPlayers.size}`);
            io.to(playerInfo.roomCode).emit('playerListUpdate', {
                players: Array.from(room.players.values()),
                bots: Array.from(room.bots.values()),
                maxPlayers: room.maxPlayers
            });
            
            io.to(playerInfo.roomCode).emit('chatMessage', {
                type: 'system',
                message: `${botName}님이 추가되었습니다.`
            });
            
            // 🚨 **수정**: 봇 추가는 로비 인원 수와 무관하므로 roomListUpdate 생략
            // (로비 인원 수는 변경되지 않으므로 불필요한 업데이트 방지)
        } else if (result && result.error === 'name_duplicate') {
            socket.emit('botAddError', {
                message: '같은 이름의 플레이어 또는 봇이 이미 방에 있습니다. 다른 이름을 사용해주세요.'
            });
        }
    });

    // 봇 제거
    socket.on('removeBot', () => {
        const playerInfo = game.players.get(socket.id);
        if (!playerInfo) return;
        
        const room = game.rooms.get(playerInfo.roomCode);
        if (!room || !room.players.get(socket.id)?.isHost) return;
        
        const result = game.removeBot(playerInfo.roomCode);
        
        if (result && !result.error) {
            io.to(playerInfo.roomCode).emit('playerListUpdate', {
                players: Array.from(room.players.values()),
                bots: Array.from(room.bots.values()),
                maxPlayers: room.maxPlayers
            });
            
            io.to(playerInfo.roomCode).emit('chatMessage', {
                type: 'system',
                message: `${result.removedBot.name}님이 제거되었습니다.`
            });
            
            // 🚨 **수정**: 봇 제거도 로비 인원 수와 무관하므로 roomListUpdate 생략
            // (로비 인원 수는 변경되지 않으므로 불필요한 업데이트 방지)
        } else if (result && result.error === 'no_bots') {
            socket.emit('botAddError', {
                message: '제거할 봇이 없습니다.'
            });
        }
    });

    // 최대 플레이어 수 설정
    socket.on('setMaxPlayers', (data) => {
        const playerInfo = game.players.get(socket.id);
        if (!playerInfo) return;
        
        const room = game.rooms.get(playerInfo.roomCode);
        if (!room || !room.players.get(socket.id)?.isHost) return;
        
        // 🚨 방어 코드: data 검증
        if (!data || typeof data !== 'object') {
            console.log(`[setMaxPlayers 오류] ${socket.id}: data가 undefined 또는 잘못된 형식`);
            return;
        }
        
        const { maxPlayers } = data;
        if (!maxPlayers || typeof maxPlayers !== 'number') {
            console.log(`[setMaxPlayers 오류] ${socket.id}: maxPlayers가 없거나 잘못된 형식`);
            return;
        }
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
        
        // 🚨 방어 코드: data 검증
        if (!data || typeof data !== 'object') {
            console.log(`[nightAction 오류] ${socket.id}: data가 undefined 또는 잘못된 형식`);
            return;
        }
        
        const { action, target } = data;
        if (!action) {
            console.log(`[nightAction 오류] ${socket.id}: action이 없음`);
            return;
        }
        console.log('밤 행동 수신:', {
            player: player.name,
            role: player.role,
            action,
            target,
            round: room.round,
            nightActionsSize: room.nightActions.size
        });
        
        room.nightActions.set(socket.id, { type: action, target, time: Date.now() });
        
        // 행동 확인 알림 전송
        console.log(`[행동 확인] ${player.name}이(가) ${action} 행동을 ${target}에게 선택`);
        const targetPlayer = room.players.get(target) || room.bots.get(target);
        const targetName = targetPlayer ? targetPlayer.name : target;
        console.log(`[행동 상세] ${player.name}(${player.role}) -> ${targetName}으로 ${action} 행동`);
        socket.emit('actionConfirmed', { action, target, playerName: player.name, targetName });
        
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
        
        // 🚨 방어 코드: data 검증
        if (!data || typeof data !== 'object') {
            console.log(`[vote 오류] ${socket.id}: data가 undefined 또는 잘못된 형식`);
            socket.emit('voteError', { message: '잘못된 투표 요청입니다.' });
            return;
        }
        
        const { target } = data;
        if (!target) {
            console.log(`[vote 오류] ${socket.id}: target이 없음`);
            socket.emit('voteError', { message: '투표 대상을 선택해주세요.' });
            return;
        }
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
        
        // 도배 방지 검사
        if (game.isPlayerBanned(socket.id)) {
            const remainingTime = game.getRemainingBanTime(socket.id);
            socket.emit('chatError', {
                message: `도배로 인해 ${remainingTime}초 동안 채팅이 금지되었습니다.`
            });
            return;
        }
        
        // 도배 검사 (3초에 5번 이상이면 10초 금지)
        if (game.checkSpamAndBan(socket.id)) {
            socket.emit('chatError', {
                message: '너무 빠르게 메시지를 보내고 있습니다. 10초 동안 채팅이 금지됩니다.'
            });
            return;
        }
        
        // 🚨 방어 코드: data 검증
        if (!data || typeof data !== 'object') {
            console.log(`[chatMessage 오류] ${socket.id}: data가 undefined 또는 잘못된 형식`);
            return;
        }
        
        const { message } = data;
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            console.log(`[chatMessage 오류] ${socket.id}: message가 없거나 잘못된 형식`);
            return;
        }
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

    // 마피아 전용 채팅 메시지
    socket.on('mafiaChatMessage', (data) => {
        const playerInfo = game.players.get(socket.id);
        if (!playerInfo) return;
        
        const room = game.rooms.get(playerInfo.roomCode);
        if (!room) return;
        
        const player = room.players.get(socket.id);
        if (!player) return;
        
        // 마피아만 메시지를 보낼 수 있음
        if (player.role !== 'mafia') {
            console.log(`마피아 채팅 접근 거부: ${player.name} (역할: ${player.role})`);
            return;
        }
        
        // 살아있어야 하고, 밤 시간이어야 함
        if (!player.alive || room.gameState !== 'night') {
            console.log(`마피아 채팅 조건 불만족: alive=${player.alive}, gameState=${room.gameState}`);
            return;
        }
        
        // 도배 방지 검사
        if (game.isPlayerBanned(socket.id)) {
            const remainingTime = game.getRemainingBanTime(socket.id);
            socket.emit('chatError', {
                message: `도배로 인해 ${remainingTime}초 동안 채팅이 금지되었습니다.`
            });
            return;
        }
        
        // 도배 검사 (3초에 5번 이상이면 10초 금지)
        if (game.checkSpamAndBan(socket.id)) {
            socket.emit('chatError', {
                message: '너무 빠르게 메시지를 보내고 있습니다. 10초 동안 채팅이 금지됩니다.'
            });
            return;
        }
        
        // 🚨 방어 코드: data 검증
        if (!data || typeof data !== 'object') {
            console.log(`[mafiaChatMessage 오류] ${socket.id}: data가 undefined 또는 잘못된 형식`);
            return;
        }
        
        const { message } = data;
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            console.log(`[mafiaChatMessage 오류] ${socket.id}: message가 없거나 잘못된 형식`);
            return;
        }
        
        const timestamp = new Date();

        // 마피아 채팅 메시지를 AI 히스토리에 저장 (특별 타입으로)
        game.botAI.addChatMessage(playerInfo.roomCode, {
            type: 'mafia_chat',
            playerId: socket.id,
            playerName: player.name,
            message,
            round: room.round,
            gamePhase: room.gameState
        }, room);

        // 마피아 팀원들에게만 메시지 전송
        const allPlayers = [...room.players.values(), ...room.bots.values()];
        const mafiaMembers = allPlayers.filter(p => p.role === 'mafia' && p.alive);
        
        console.log(`마피아 채팅 전송: ${player.name} -> ${mafiaMembers.length}명의 마피아에게`);
        
        for (const mafia of mafiaMembers) {
            // 봇이 아닌 플레이어에게만 전송
            if (!mafia.isBot) {
                io.to(mafia.id).emit('mafiaChatMessage', {
                    type: 'mafia',
                    playerName: player.name,
                    message,
                    timestamp
                });
            }
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
        console.log(`[연결 해제 전] 로비 인원: ${game.lobbyPlayers.size}`);
        
        const room = game.removePlayer(socket.id);
        console.log(`[연결 해제 후] 로비 인원: ${game.lobbyPlayers.size}`);
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
    room.timeLeft = 20; // 20초 (5초 증가)
    
    // 살아있는 플레이어들의 역할 확인
    const alivePlayers = game.getAlivePlayers(room);
    console.log('살아있는 플레이어들:', alivePlayers.map(p => ({ name: p.name, role: p.role, alive: p.alive })));
    
    io.to(roomCode).emit('phaseChange', {
        phase: 'night',
        timeLeft: room.timeLeft,
        round: room.round
    });
    
    // 마피아 봇들의 밤 시간 채팅 시작
    game.botAI.triggerMafiaChats(room);
    
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
    
    // results가 null인 경우 에러 방지
    if (!results) {
        console.error(`[에러] ${roomCode} 방의 밤 결과 처리가 실패했습니다.`);
        room.gameState = 'morning';
        io.to(roomCode).emit('phaseChange', {
            phase: 'morning',
            results: { killed: null, saved: null, investigated: null, roleSwapped: null }
        });
        return;
    }
    
    room.gameState = 'morning';
    
    // 마법사 역할 교환이 있었다면 해당 플레이어들에게 새로운 역할 정보 전송
    if (results.roleSwapped && results.roleSwapped.success) {
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
    } else if (results.roleSwapped && !results.roleSwapped.success) {
        // 역할 교환 실패 메시지 (마법사에게만 전송)
        if (room.players.has(results.roleSwapped.wizard)) {
            io.to(results.roleSwapped.wizard).emit('nightActionResult', {
                type: 'swapFailed',
                message: '역할 교환에 실패했습니다.'
            });
        }
        console.log(`마법사 역할 교환 실패 - 실제 플레이어에게 알림 전송`);
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
    
    // 밤 결과를 room에 저장 (토론 시간에 사용)
    room.lastNightResults = results;
    
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
    room.timeLeft = 40; // 40초 (5초 감소)
    
    io.to(roomCode).emit('phaseChange', {
        phase: 'discussion',
        timeLeft: room.timeLeft
    });
    
    // 봇들이 토론 시간에 채팅하도록 트리거 (밤 결과 포함)
    const nightResults = room.lastNightResults || null;
    game.botAI.triggerBotChats(room, 'discussion', { nightResults });
    
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
    
    // 봇들이 투표 시간에 채팅하도록 트리거
    game.botAI.triggerBotChats(room, 'voting');
    
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
    // 각 후보별 득표 수 집계 (정치인 가중치 반영)
    const voteCountsMap = new Map();
    
    for (const [voter, target] of room.votes) {
        const count = voteCountsMap.get(target) || 0;
        
        // 투표자의 역할 확인
        const voterPlayer = room.players.get(voter) || room.bots.get(voter);
        let voteWeight = 1; // 기본 투표 가중치
        
        // 정치인은 1.5표의 가중치를 가짐
        if (voterPlayer && voterPlayer.role === 'politician') {
            voteWeight = 1.5;
        }
        
        voteCountsMap.set(target, count + voteWeight);
    }
    const voteCounts = Array.from(voteCountsMap.entries()); // [ [targetId, count], ... ] 형식

    const voteDetails = room.votePublic ? Array.from(room.votes.entries()) : null;

    const eliminated = game.processVoting(room);

    // 정치인 투표 정보 추가
    const politicianVotes = [];
    for (const [voter, target] of room.votes) {
        const voterPlayer = room.players.get(voter) || room.bots.get(voter);
        if (voterPlayer && voterPlayer.role === 'politician') {
            politicianVotes.push({
                voter: voter,
                target: target,
                voterName: voterPlayer.name
            });
        }
    }

    io.to(roomCode).emit('votingResults', {
        eliminated: eliminated,
        voteDetails: voteDetails,
        voteCounts: voteCounts,
        votePublic: room.votePublic,
        politicianVotes: politicianVotes
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