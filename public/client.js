// 전역 변수
let socket;
const SESSION_KEY = 'mafiaSessionId';
let sessionId = localStorage.getItem(SESSION_KEY);
if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substr(2, 9) + Date.now();
    localStorage.setItem(SESSION_KEY, sessionId);
}
let currentRoom = null;
let playerData = null;
let gameState = null;
let isHost = false;
let selectedTarget = null;
let currentPlayers = [];
let currentBots = [];

// DOM 요소들
const screens = {
    lobby: document.getElementById('lobbyScreen'),
    waiting: document.getElementById('waitingScreen'),
    game: document.getElementById('gameScreen'),
    gameEnd: document.getElementById('gameEndScreen')
};

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
    initializeSocket();
    setupEventListeners();
    setupAudio();
    requestNotificationPermission();
    showScreen('lobby');
});

// 브라우저 알림 권한 요청
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                console.log('브라우저 알림 권한 허용됨');
            }
        });
    }
}

// Socket.IO 초기화
function initializeSocket() {
    socket = io();
    
    // 연결 이벤트
    socket.on('connect', () => {
        console.log('서버에 연결되었습니다.');
        refreshRoomList();
    });
    
    socket.on('disconnect', () => {
        console.log('서버와의 연결이 끊어졌습니다.');
        showToast('서버와의 연결이 끊어졌습니다.');
    });
    
    // 방 관련 이벤트
    socket.on('roomCreated', handleRoomCreated);
    socket.on('roomJoined', handleRoomJoined);
    socket.on('joinError', handleJoinError);
    socket.on('playerListUpdate', handlePlayerListUpdate);
    
    // 게임 관련 이벤트
    socket.on('gameStarted', handleGameStarted);
    socket.on('gameStartError', handleGameStartError);
    socket.on('roleAssigned', handleRoleAssigned);
    socket.on('phaseChange', handlePhaseChange);
    socket.on('timerUpdate', handleTimerUpdate);
    socket.on('nightResults', handleNightResults);
    socket.on('votingResults', handleVotingResults);
    socket.on('gameEnd', handleGameEnd);
    socket.on('actionConfirmed', handleActionConfirmed);
    socket.on('voteConfirmed', handleVoteConfirmed);
    socket.on('gameReset', handleGameReset);
    
    // 채팅 관련 이벤트
    socket.on('chatMessage', handleChatMessage);
    socket.on('mafiaChatMessage', handleMafiaChatMessage);
    socket.on('chatError', handleChatError);
    socket.on('voteError', handleVoteError);
    
    // 봇 추가 오류 이벤트
    socket.on('botAddError', handleBotAddError);
    
    // 마피아 팀 행동 알림
    socket.on('mafiaTeamAction', handleMafiaTeamAction);
    
    // 방 목록 관련 이벤트
    socket.on('roomList', handleRoomList);
    socket.on('roomListUpdate', refreshRoomList);
    
    // 투표 공개 설정 업데이트
    socket.on('voteVisibilityUpdated', handleVoteVisibilityUpdated);

    // 밤 결과 처리
    socket.on('nightResults', (results) => {
        console.log('밤 결과:', results);
        
        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'night-results';
        
        let resultsText = '';
        
        if (results.killed) {
            const killedPlayerName = getPlayerNameById(results.killed);
            resultsText += `💀 ${killedPlayerName}이(가) 죽었습니다.\n`;
        }
        
        // 치료 정보는 의사에게만 공개
        if (results.saved && playerData?.role === 'doctor') {
            const savedPlayerName = getPlayerNameById(results.saved);
            resultsText += `💚 ${savedPlayerName}을(를) 치료했습니다.\n`;
        }
        
        if (results.investigated && playerData?.role === 'police') {
            const investigatedPlayerName = getPlayerNameById(results.investigated.target);
            const resultText = results.investigated.result === 'mafia' ? '🔴 마피아' : '🔵 시민';
            resultsText += `🔍 ${investigatedPlayerName}의 조사 결과: ${resultText}\n`;
        }
        
        if (results.spiritInvestigated && playerData?.role === 'shaman') {
            const investigatedPlayerName = getPlayerNameById(results.spiritInvestigated.target);
            const roleDisplayName = getRoleDisplayName(results.spiritInvestigated.targetRole);
            resultsText += `🔮 ${investigatedPlayerName}의 영혼 조사 결과: ${roleDisplayName}\n`;
        }
        
        if (results.roleSwapped) {
            if (results.roleSwapped.success) {
                if (results.roleSwapped.wizard === socket.id) {
                    // 마법사 본인인 경우
                    resultsText += `✨ 역할 교환에 성공했습니다! 새로운 역할: ${getRoleDisplayName(results.roleSwapped.wizardNewRole)}\n`;
                } else if (results.roleSwapped.target === socket.id) {
                    // 교환 대상인 경우
                    resultsText += `✨ 마법사가 당신의 역할을 가져갔습니다. 새로운 역할: 시민\n`;
                }
                // 다른 플레이어들에게는 역할 교환 사실을 알리지 않음
            } else {
                if (results.roleSwapped.wizard === socket.id) {
                    // 마법사 본인인 경우만 실패 알림
                    resultsText += `❌ 역할 교환에 실패했습니다.\n`;
                }
                // 다른 플레이어들에게는 실패 사실을 알리지 않음
            }
        }
        
        if (resultsText) {
            resultsDiv.textContent = resultsText.trim();
            showToast(resultsText.trim(), 'info', 5000);
        }
    });

    // 밤 행동 결과 처리 (역할 교환 실패 등)
    socket.on('nightActionResult', (data) => {
        console.log('밤 행동 결과:', data);
        
        if (data.type === 'swapFailed') {
            showToast('❌ ' + data.message, 'error', 3000);
        }
    });
}

// 이벤트 리스너 설정
function setupEventListeners() {
    // 로비 화면
    document.getElementById('createRoomBtn').addEventListener('click', createRoom);
    document.getElementById('joinRoomBtn').addEventListener('click', joinRoom);
    document.getElementById('gameGuideBtn').addEventListener('click', showGameGuide);
    document.getElementById('playerName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') createRoom();
    });
    document.getElementById('roomCodeInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom();
    });
    
    // 방 목록 관련
    document.getElementById('refreshRoomsBtn').addEventListener('click', refreshRoomList);
    
    // 대기실 화면
    document.getElementById('copyCodeBtn').addEventListener('click', copyRoomCode);
    document.getElementById('maxPlayersSelect').addEventListener('change', setMaxPlayers);
    document.getElementById('addBotBtn').addEventListener('click', addBot);
    document.getElementById('removeBotBtn').addEventListener('click', removeBot);
    document.getElementById('startGameBtn').addEventListener('click', startGame);
    document.getElementById('sendChatBtn').addEventListener('click', sendChatMessage);
    document.getElementById('chatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
    
    // 게임 화면
    document.getElementById('sendGameChatBtn').addEventListener('click', sendGameChatMessage);
    document.getElementById('gameChatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendGameChatMessage();
    });
    
    // 마피아 전용 채팅 (밤 시간에만 표시됨)
    document.getElementById('sendMafiaChatBtn').addEventListener('click', sendMafiaChatMessage);
    document.getElementById('mafiaChatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMafiaChatMessage();
    });
    
    // 게임 종료 화면
    document.getElementById('newGameBtn').addEventListener('click', () => {
        // 호스트만 새 게임 초기화를 요청
        if (isHost) {
            socket.emit('resetGame');
        } else {
            showToast('호스트가 새 게임을 준비 중입니다.');
        }
    });
    document.getElementById('backToLobbyBtn').addEventListener('click', () => location.reload());
    
    // 모달
    document.getElementById('modalOkBtn').addEventListener('click', hideModal);
    document.getElementById('modalCancelBtn').addEventListener('click', hideModal);
    
    // 게임 가이드 모달
    document.getElementById('gameGuideCloseBtn').addEventListener('click', hideGameGuide);
    
    // 추가: 투표 공개 설정
    const voteVisibilitySelect = document.getElementById('voteVisibilitySelect');
    if (voteVisibilitySelect) {
        voteVisibilitySelect.addEventListener('change', () => {
            if (!isHost) return;
            const value = voteVisibilitySelect.value;
            const votePublic = value === 'public';
            socket.emit('setVoteVisibility', { votePublic });
        });
    }
}

// 화면 전환
function showScreen(screenName) {
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    screens[screenName].classList.add('active');
}

// 방 생성
function createRoom() {
    const playerName = document.getElementById('playerName').value.trim();
    
    if (!playerName) {
        showToast('플레이어 이름을 입력해주세요.');
        return;
    }
    
    if (playerName.length > 15) {
        showToast('플레이어 이름은 15자 이하로 입력해주세요.');
        return;
    }
    
    showLoadingSpinner();
    socket.emit('createRoom', { playerName, sessionId });
}

// 방 참가
function joinRoom() {
    const playerName = document.getElementById('playerName').value.trim();
    const roomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();
    
    if (!playerName) {
        showToast('플레이어 이름을 입력해주세요.');
        return;
    }
    
    if (!roomCode) {
        showToast('방 코드를 입력해주세요.');
        return;
    }
    
    if (playerName.length > 15) {
        showToast('플레이어 이름은 15자 이하로 입력해주세요.');
        return;
    }
    
    showLoadingSpinner();
    socket.emit('joinRoom', { roomCode, playerName, sessionId });
}

// 방 생성 성공 처리
function handleRoomCreated(data) {
    hideLoadingSpinner();
    if (data.success) {
        currentRoom = data.roomCode;
        isHost = true;
        document.getElementById('currentRoomCode').textContent = data.roomCode;
        showScreen('waiting');
        showToast('방이 생성되었습니다!');
    }
}

// 방 참가 성공 처리
function handleRoomJoined(data) {
    hideLoadingSpinner();
    if (data.success) {
        currentRoom = data.roomCode;
        isHost = false;
        document.getElementById('currentRoomCode').textContent = data.roomCode;
        showScreen('waiting');
        showToast('방에 참가했습니다!');
        
        // 호스트 컨트롤 숨기기
        document.getElementById('hostControls').style.display = 'none';
    }
}

// 방 참가 오류 처리
function handleJoinError(data) {
    hideLoadingSpinner();
    showToast(data.message);
}

// 플레이어 목록 업데이트
function handlePlayerListUpdate(data) {
    currentPlayers = data.players;
    currentBots = data.bots;
    
    updatePlayersList(data.players, data.bots, data.maxPlayers);
    
    // 게임 화면에서도 플레이어 목록 업데이트
    if (screens.game.classList.contains('active')) {
        updateGamePlayersList(data.players, data.bots);
        // 현재 플레이어가 죽었는지 확인하고 UI 업데이트
        updatePlayerUIBasedOnStatus();
    }
    
    // 게임 시작 버튼 활성화/비활성화
    if (isHost) {
        const totalPlayers = data.players.length + data.bots.length;
        const startBtn = document.getElementById('startGameBtn');
        if (startBtn) {
            startBtn.disabled = totalPlayers < 5;
        }
    }
}

// 플레이어 목록 UI 업데이트
function updatePlayersList(players, bots, maxPlayers) {
    const playersList = document.getElementById('playersList');
    const currentPlayers = document.getElementById('currentPlayers');
    const maxPlayersSpan = document.getElementById('maxPlayers');
    
    currentPlayers.textContent = players.length + bots.length;
    maxPlayersSpan.textContent = maxPlayers;
    
    playersList.innerHTML = '';
    
    // 현재 플레이어를 맨 위로 정렬
    const sortedPlayers = [...players].sort((a, b) => {
        if (a.id === socket.id) return -1;
        if (b.id === socket.id) return 1;
        return 0;
    });
    
    // 실제 플레이어들 (정렬된 순서)
    sortedPlayers.forEach(player => {
        const playerItem = createPlayerItem(player, false);
        playersList.appendChild(playerItem);
    });
    
    // 봇들
    bots.forEach(bot => {
        const botItem = createPlayerItem(bot, true);
        playersList.appendChild(botItem);
    });
    
    // 내 이름을 헤더에 표시 (게임 화면용)
    const me = [...players, ...bots].find(p => p.id === socket.id);
    if (me) {
        const roleLabel = document.querySelector('.player-role span'); // 첫 번째 span
        if (roleLabel) {
            roleLabel.textContent = `당신 (${me.name})의 역할: `;
        }
    }
}

// 플레이어 아이템 생성
function createPlayerItem(player, isBot) {
    const div = document.createElement('div');
    div.className = 'player-item';
    
    // 현재 플레이어 강조 표시
    if (player.id === socket.id) {
        div.classList.add('current-player');
    }
    
    const playerInfo = document.createElement('div');
    playerInfo.className = 'player-info';
    
    const playerName = document.createElement('span');
    playerName.className = 'player-name clickable-nickname';
    playerName.textContent = player.name;
    playerName.title = '클릭하여 닉네임 복사';
    
    // 닉네임 클릭 이벤트 추가
    playerName.addEventListener('click', () => {
        copyNicknameToChat(player.name);
    });
    
    playerInfo.appendChild(playerName);
    
    if (player.isHost) {
        const hostBadge = document.createElement('span');
        hostBadge.className = 'player-badge host';
        hostBadge.textContent = '호스트';
        playerInfo.appendChild(hostBadge);
    }
    
    // 봇 배지는 표시하지 않음 (이름에 이미 봇이라고 포함되어 있음)
    
    // 현재 플레이어 배지
    if (player.id === socket.id) {
        const meBadge = document.createElement('span');
        meBadge.className = 'player-badge me';
        meBadge.textContent = '나';
        playerInfo.appendChild(meBadge);
    }
    
    div.appendChild(playerInfo);
    
    return div;
}

// 방 코드 복사
function copyRoomCode() {
    const roomCode = document.getElementById('currentRoomCode').textContent;
    navigator.clipboard.writeText(roomCode).then(() => {
        showToast('방 코드가 복사되었습니다!');
    });
}

// 최대 플레이어 수 설정
function setMaxPlayers() {
    if (!isHost) return;
    
    const maxPlayers = parseInt(document.getElementById('maxPlayersSelect').value);
    socket.emit('setMaxPlayers', { maxPlayers });
}

// 봇 추가
function addBot() {
    if (!isHost) return;
    
    // 재미있는 봇 이름 목록
    const funnyBotNames = [
        '너마피아잖아',
        '말투가찐인데',
        '니가뭘할수있는데',
        '몰루',
        '어어딜가노',
        '조용한놈이수상함',
        '이게맞냐',
        '목소리큰놈이범인',
        '말없으면마피아',
        '아니라고했잖아',
        '선동과날조',
        '과몰입금지',
        '쟤가범인임',
        '이번판은졌네',
        '의사야힐좀줘라',
        '경찰이일을안함',
        '형은다알고있다',
        '지령내리지마라',
        '니가더수상함',
        '어차피죽을목숨',
        '증거있냐고',
        '무지성투표ㄱㄱ',
        '딱보니까알겠네',
        '아니면어쩔건데',
        '이길생각없음',
        '빨리좀죽여줘',
        '투표하기싫어',
        '그냥다죽자',
        '억까하지마라',
        '뇌는장식임',
        '죽으면그만이야',
        '닉네임이수상함',
        '쟤부터죽여보죠',
        '대충투표함',
        '말많으면시민임'
    ];
    
    // 이미 사용된 이름들 수집 (플레이어 + 봇)
    const usedNames = new Set();
    currentPlayers.forEach(player => usedNames.add(player.name));
    currentBots.forEach(bot => usedNames.add(bot.name));
    
    // 사용 가능한 이름 필터링
    const availableNames = funnyBotNames.filter(name => !usedNames.has(name));
    
    let botName;
    if (availableNames.length > 0) {
        // 사용 가능한 재미있는 이름 중 랜덤 선택
        const randomIndex = Math.floor(Math.random() * availableNames.length);
        botName = availableNames[randomIndex];
    } else {
        // 모든 재미있는 이름이 사용된 경우 기본 이름 사용
        const botCount = currentBots.length + 1;
        botName = `봇${botCount}`;
    }
    
    socket.emit('addBot', { botName });
}

// 봇 제거
function removeBot() {
    if (!isHost) return;
    
    if (currentBots.length === 0) {
        showToast('제거할 봇이 없습니다.');
        return;
    }
    
    socket.emit('removeBot');
}

// 게임 시작
function startGame() {
    if (!isHost) return;
    
    // 현재 투표 공개 설정을 서버에 전송 (게임 시작 전에 보장)
    const voteVisibilitySelect = document.getElementById('voteVisibilitySelect');
    if (voteVisibilitySelect) {
        const votePublic = voteVisibilitySelect.value === 'public';
        socket.emit('setVoteVisibility', { votePublic });
    }
    
    socket.emit('startGame');
}

// 게임 시작 처리
function handleGameStarted(data) {
    // 새 게임 시작 시 이전 결과 기록 초기화
    const resultsContent = document.getElementById('resultsContent');
    const resultsArea = document.getElementById('resultsArea');
    if (resultsContent) resultsContent.innerHTML = '';
    if (resultsArea) resultsArea.classList.add('hidden');

    // 새 게임 시작 시 이전 토론 내역 초기화
    const gameChatMessages = document.getElementById('gameChatMessages');
    if (gameChatMessages) gameChatMessages.innerHTML = '';

    gameState = data;
    showScreen('game');
    document.getElementById('currentRound').textContent = data.round;
    
    // 게임 플레이어 목록 초기화
    updateGamePlayersList(currentPlayers, currentBots);
    
    updateTheme(data.gameState || 'night');
    
    showToast('게임이 시작되었습니다!');
}

// 게임 시작 오류 처리
function handleGameStartError(data) {
    showToast(data.message);
}

// 역할 배정 처리
function handleRoleAssigned(data) {
    playerData = data;
    console.log('역할 배정됨:', { role: data.role, gameStarted: data.gameStarted, playerData });
    
    const roleElement = document.getElementById('playerRole');
    roleElement.textContent = getRoleDisplayName(data.role);
    roleElement.className = `role-badge ${data.role}`;
    roleElement.title = '클릭하여 역할 설명 보기';

    // 역할 설명 툴팁 이벤트 추가
    setupRoleTooltip(roleElement, data.role);

    // 이전에 표시된 마피아 팀 정보 제거
    const existingTeamInfo = document.getElementById('mafiaTeamInfo');
    if (existingTeamInfo) {
        existingTeamInfo.remove();
    }

    // 마피아인 경우 팀 정보 표시
    if (data.role === 'mafia' && data.mafiaTeam) {
        console.log('마피아 팀 구성원:', data.mafiaTeam);
        
        // 마피아 팀 정보를 표시할 영역 생성
        const gameHeader = document.querySelector('.game-header');
        let mafiaTeamInfo = document.getElementById('mafiaTeamInfo');
        
        if (!mafiaTeamInfo) {
            mafiaTeamInfo = document.createElement('div');
            mafiaTeamInfo.id = 'mafiaTeamInfo';
            mafiaTeamInfo.className = 'mafia-team-info';
            gameHeader.appendChild(mafiaTeamInfo);
        }
        
        const teamMembers = data.mafiaTeam.map(member => 
            `${member.name}${member.isBot ? ' (봇)' : ''}`
        ).join(', ');
        
        mafiaTeamInfo.innerHTML = `
            <div class="team-title">🔴 마피아 팀</div>
            <div class="team-members">${teamMembers}</div>
        `;
    }
}

// 역할 표시명 반환
function getRoleDisplayName(role) {
    const roleNames = {
        'mafia': '마피아',
        'citizen': '시민',
        'doctor': '의사',
        'police': '경찰',
        'wizard': '마법사',
        'joker': '조커',
        'shaman': '무당',
        'politician': '정치인'
    };
    return roleNames[role] || role;
}

// 게임 단계 변경 처리
function handlePhaseChange(data) {
    const phaseElement = document.getElementById('gamePhase');
    const timeLeftElement = document.getElementById('timeLeft');
    
    phaseElement.textContent = getPhaseDisplayName(data.phase);
    timeLeftElement.textContent = data.timeLeft || '--';
    
    if (data.round) {
        document.getElementById('currentRound').textContent = data.round;
    }
    
    updateActionArea(data.phase);
    updateChatInput(data.phase);
    updateTheme(data.phase);
    
    // 중복 기록 방지를 위해 phaseChange 이벤트에서는 결과 로그를 처리하지 않습니다.
    // nightResults, votingResults 등의 개별 이벤트에서만 결과를 기록합니다.
}

// 단계 표시명 반환
function getPhaseDisplayName(phase) {
    const phaseNames = {
        'night': '밤이 되었습니다',
        'morning': '아침이 되었습니다',
        'discussion': '토론 시간',
        'voting': '투표 시간',
        'gameOver': '게임 종료'
    };
    return phaseNames[phase] || phase;
}

// 타이머 업데이트
function handleTimerUpdate(data) {
    document.getElementById('timeLeft').textContent = data.timeLeft;
}

// 액션 영역 업데이트
function updateActionArea(phase) {
    const actionArea = document.getElementById('actionArea');
    const actionTitle = document.getElementById('actionTitle');
    const actionButtons = document.getElementById('actionButtons');
    const targetSelection = document.getElementById('targetSelection');
    
    actionButtons.innerHTML = '';
    targetSelection.classList.add('hidden');
    selectedTarget = null;
    
    // 죽은 플레이어는 아무 행동도 할 수 없음
    if (!isCurrentPlayerAlive()) {
        actionTitle.textContent = '당신은 죽었습니다';
        const deadMessage = document.createElement('div');
        deadMessage.textContent = '죽은 플레이어는 게임에 참여할 수 없습니다.';
        deadMessage.style.textAlign = 'center';
        deadMessage.style.color = 'var(--accent-color)';
        deadMessage.style.fontWeight = 'bold';
        actionButtons.appendChild(deadMessage);
        return;
    }
    
    switch (phase) {
        case 'night':
            if (playerData && playerData.role) {
                actionTitle.textContent = '밤 행동을 선택하세요';
                createNightActionButtons();
            } else {
                actionTitle.textContent = '밤이 되었습니다...';
            }
            break;
            
        case 'discussion':
            actionTitle.textContent = '토론 중입니다';
            break;
            
        case 'voting':
            actionTitle.textContent = '투표할 플레이어를 선택하세요';
            createVoteButton();
            break;
            
        default:
            actionTitle.textContent = '대기 중...';
    }
}

// 밤 행동 버튼 생성
function createNightActionButtons() {
    const actionButtons = document.getElementById('actionButtons');
    
    console.log('밤 행동 버튼 생성:', { role: playerData?.role, isAlive: isCurrentPlayerAlive() });
    
    switch (playerData.role) {
        case 'mafia':
            const killBtn = createActionButton('kill', '공격하기', 'kill');
            actionButtons.appendChild(killBtn);
            console.log('마피아 공격 버튼 생성');
            break;
            
        case 'doctor':
            const saveBtn = createActionButton('save', '치료하기', 'save');
            actionButtons.appendChild(saveBtn);
            console.log('의사 치료 버튼 생성');
            break;
            
        case 'police':
            const investigateBtn = createActionButton('investigate', '수사하기', 'investigate');
            actionButtons.appendChild(investigateBtn);
            console.log('경찰 수사 버튼 생성');
            break;
            
        case 'wizard':
            const swapBtn = createActionButton('swap', '직업 뺏기', 'swap');
            actionButtons.appendChild(swapBtn);
            console.log('마법사 직업 교환 버튼 생성');
            break;
            
        case 'citizen':
            const waitDiv = document.createElement('div');
            waitDiv.textContent = '시민은 밤에 할 수 있는 행동이 없습니다.';
            waitDiv.style.textAlign = 'center';
            waitDiv.style.color = 'var(--text-light)';
            actionButtons.appendChild(waitDiv);
            console.log('시민 대기 메시지 생성');
            break;
            
        case 'joker':
            const jokerWaitDiv = document.createElement('div');
            jokerWaitDiv.textContent = '조커는 밤에 할 수 있는 행동이 없습니다. 마피아의 공격을 기다리세요.';
            jokerWaitDiv.style.textAlign = 'center';
            jokerWaitDiv.style.color = 'var(--text-light)';
            actionButtons.appendChild(jokerWaitDiv);
            console.log('조커 대기 메시지 생성');
            break;
            
        case 'shaman':
            const spiritInvestigateBtn = createActionButton('spirit_investigate', '영혼 조사', 'spirit_investigate');
            actionButtons.appendChild(spiritInvestigateBtn);
            console.log('무당 영혼 조사 버튼 생성');
            break;
            
        default:
            console.log('알 수 없는 역할:', playerData?.role);
    }
}

// 투표 버튼 생성
function createVoteButton() {
    const actionButtons = document.getElementById('actionButtons');
    const voteBtn = createActionButton('vote', '투표하기', 'vote');
    actionButtons.appendChild(voteBtn);
}

// 액션 버튼 생성
function createActionButton(action, text, className) {
    const button = document.createElement('button');
    button.className = `action-btn ${className}`;
    button.textContent = text;
    button.addEventListener('click', () => showTargetSelection(action));
    return button;
}

// 대상 선택 화면 표시
function showTargetSelection(action) {
    const targetSelection = document.getElementById('targetSelection');
    const targetList = document.getElementById('targetList');
    
    targetList.innerHTML = '';
    
    const alivePlayers = getAlivePlayersForSelection(action);
    
    console.log('대상 선택 화면 표시:', { 
        action, 
        availableTargets: alivePlayers.length,
        targets: alivePlayers.map(p => ({ id: p.id, name: p.name, alive: p.alive }))
    });
    
    if (alivePlayers.length === 0) {
        const noTargetDiv = document.createElement('div');
        noTargetDiv.textContent = '선택할 수 있는 대상이 없습니다.';
        noTargetDiv.style.textAlign = 'center';
        noTargetDiv.style.color = 'var(--text-light)';
        targetList.appendChild(noTargetDiv);
    } else {
        alivePlayers.forEach(player => {
            const targetBtn = document.createElement('div');
            targetBtn.className = 'target-btn';
            targetBtn.textContent = player.name;
            targetBtn.addEventListener('click', () => selectTarget(player.id, targetBtn, action));
            targetList.appendChild(targetBtn);
        });
    }
    
    targetSelection.classList.remove('hidden');
}

// 대상 선택
function selectTarget(playerId, buttonElement, action) {
    // 죽은 플레이어는 행동할 수 없음
    if (!isCurrentPlayerAlive()) {
        if (action === 'vote') {
            showToast('죽은 사람은 투표할 수 없습니다.');
        } else {
            showToast('죽은 사람은 행동할 수 없습니다.');
        }
        return;
    }
    
    // 이전 선택 해제
    document.querySelectorAll('.target-btn.selected').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    // 새 선택
    buttonElement.classList.add('selected');
    selectedTarget = playerId;
    
    // 행동 전송
    setTimeout(() => {
        if (action === 'vote') {
            socket.emit('vote', { target: selectedTarget });
        } else {
            socket.emit('nightAction', { action: action, target: selectedTarget });
        }
    }, 500);
}

// 게임 플레이어 목록 업데이트
function updateGamePlayersList(players, bots) {
    const gamePlayersList = document.getElementById('gamePlayersList');
    if (!gamePlayersList) return;
    
    gamePlayersList.innerHTML = '';
    
    const combined = [...players, ...bots];
    // 현재 플레이어를 맨 위로 정렬
    combined.sort((a, b) => {
        if (a.id === socket.id) return -1;
        if (b.id === socket.id) return 1;
        return 0;
    });
    
    combined.forEach(player => {
        const playerItem = document.createElement('div');
        playerItem.className = 'game-player-item';
        if (!player.alive) {
            playerItem.classList.add('dead');
        }
        
        // 현재 플레이어 강조 표시
        if (player.id === socket.id) {
            playerItem.classList.add('current-player');
        }
        
        // 마피아 플레이어인 경우 마피아 팀원들을 표시
        const isMafiaTeammate = playerData?.role === 'mafia' && 
                               playerData?.mafiaTeam?.some(member => member.id === player.id);
        if (isMafiaTeammate) {
            playerItem.classList.add('mafia-teammate');
        }
        
        const playerStatus = document.createElement('div');
        playerStatus.className = 'player-status';
        
        const statusIndicator = document.createElement('div');
        statusIndicator.className = 'status-indicator';
        if (!player.alive) {
            statusIndicator.classList.add('dead');
        }
        
        const playerName = document.createElement('span');
        playerName.className = 'clickable-nickname';
        playerName.textContent = player.name;
        playerName.title = '클릭하여 닉네임 복사';
        
        // 닉네임 클릭 이벤트 추가
        playerName.addEventListener('click', () => {
            copyNicknameToChat(player.name);
        });
        
        playerStatus.appendChild(statusIndicator);
        playerStatus.appendChild(playerName);
        
        // 봇 배지는 표시하지 않음 (이름에 이미 봇이라고 포함되어 있음)
        
        // 마피아 팀원 표시
        if (isMafiaTeammate) {
            const mafiaBadge = document.createElement('span');
            mafiaBadge.className = 'player-badge mafia-team';
            mafiaBadge.textContent = '마피아';
            playerStatus.appendChild(mafiaBadge);
        }
        
        // 현재 플레이어 배지
        if (player.id === socket.id) {
            const meBadge = document.createElement('span');
            meBadge.className = 'player-badge me';
            meBadge.textContent = '나';
            playerStatus.appendChild(meBadge);
        }
        
        playerItem.appendChild(playerStatus);
        gamePlayersList.appendChild(playerItem);
    });
}

// 살아있는 플레이어 목록 반환 (대상 선택용)
function getAlivePlayersForSelection(action) {
    const allPlayers = [...currentPlayers, ...currentBots];
    
    // 무당의 경우 죽은 플레이어만 선택 가능
    if (action === 'spirit_investigate') {
        return allPlayers.filter(player => {
            return !player.alive; // 죽은 플레이어만 선택 가능
        });
    }
    
    return allPlayers.filter(player => {
        if (!player.alive) return false;
        
        // 행동에 따른 대상 제한
        if (action === 'kill') {
            // 마피아는 자기 자신을 공격할 수 없음
            if (player.id === socket.id) return false;
        } else if (action === 'investigate') {
            // 경찰은 자기 자신을 수사할 필요 없음
            if (player.id === socket.id) return false;
        } else if (action === 'save') {
            // 의사는 자기 자신을 치료할 수 없음
            if (player.id === socket.id) return false;
        } else if (action === 'swap') {
            // 마법사는 자기 자신과 직업을 교환할 수 없음
            if (player.id === socket.id) return false;
        } else if (action === 'vote') {
            // 투표에서는 자기 자신을 제외
            if (player.id === socket.id) return false;
        }
        
        return true;
    });
}

// 채팅 입력 상태 업데이트
function updateChatInput(phase) {
    const chatInput = document.getElementById('gameChatInput');
    const sendBtn = document.getElementById('sendGameChatBtn');
    
    // 마피아 전용 채팅 관련 요소들
    const mafiaChat = document.getElementById('mafiaChat');
    const mafiaChatInput = document.getElementById('mafiaChatInput');
    const sendMafiaChatBtn = document.getElementById('sendMafiaChatBtn');
    
    // 마피아 전용 채팅창 표시/숨김 처리
    if (phase === 'night' && playerData?.role === 'mafia' && isCurrentPlayerAlive()) {
        // 밤 시간이고 마피아이고 살아있으면 마피아 채팅 활성화
        if (mafiaChat) {
            mafiaChat.style.display = 'block';
            mafiaChatInput.disabled = false;
            sendMafiaChatBtn.disabled = false;
            mafiaChatInput.placeholder = '마피아팀 대화...';
        }
    } else {
        // 그 외의 경우 마피아 채팅 숨김
        if (mafiaChat) {
            mafiaChat.style.display = 'none';
        }
    }
    
    // 사망자는 언제든지 사망자 채팅 가능
    if (!isCurrentPlayerAlive()) {
        chatInput.disabled = false;
        sendBtn.disabled = false;
        chatInput.placeholder = '사망자 전용 채팅...';
        return;
    }
    
    if (phase === 'discussion') {
        chatInput.disabled = false;
        sendBtn.disabled = false;
        chatInput.placeholder = '토론에 참여하세요...';
    } else if (phase === 'voting') {
        chatInput.disabled = false;
        sendBtn.disabled = false;
        chatInput.placeholder = '투표하며 대화하세요...';
    } else {
        chatInput.disabled = true;
        sendBtn.disabled = true;
        chatInput.placeholder = '토론/투표 시간에만 채팅할 수 있습니다...';
    }
}

// 밤 결과 표시
function handleNightResults(results) {
    showNightResults(results);
}

// 밤 결과 UI 표시
function showNightResults(results) {
    const resultsArea = document.getElementById('resultsArea');
    const resultsContent = document.getElementById('resultsContent');
    
    // 결과 영역이 비어 있으면 <hr>를 넣지 않음
    const needSeparator = resultsContent.children.length > 0;

    if (needSeparator) {
        const hr = document.createElement('hr');
        hr.className = 'result-separator';
        resultsContent.appendChild(hr);
    }
    
    if (results.killed) {
        const killedPlayerName = getPlayerNameById(results.killed);
        const killedDiv = document.createElement('div');
        killedDiv.innerHTML = `💀 <strong>${killedPlayerName}님</strong>이 마피아에게 공격당했습니다.`;
        killedDiv.style.color = 'var(--accent-color)';
        resultsContent.appendChild(killedDiv);
    }
    
    if (results.saved) {
        const savedDiv = document.createElement('div');
        savedDiv.innerHTML = `💚 누군가가 의사의 치료를 받았습니다.`;
        savedDiv.style.color = 'var(--success-color)';
        resultsContent.appendChild(savedDiv);
    }
    
    if (results.investigated && results.investigated.investigator === socket.id) {
        const investigatedPlayerName = getPlayerNameById(results.investigated.target);
        const investigateDiv = document.createElement('div');
        const resultText = results.investigated.result === 'mafia' ? '마피아입니다' : '마피아가 아닙니다';
        investigateDiv.innerHTML = `🔍 <strong>${investigatedPlayerName}님</strong>은 <strong>${resultText}</strong>.`;
        investigateDiv.style.color = 'var(--secondary-color)';
        resultsContent.appendChild(investigateDiv);
    }
    
    // 조커 반격 결과를 일반 살해로 표시
    if (results.jokerRevenge) {
        const killedMafiaName = getPlayerNameById(results.jokerRevenge.killedMafia);
        const killedDiv = document.createElement('div');
        killedDiv.innerHTML = `💀 <strong>${killedMafiaName}님</strong>이 마피아에게 공격당했습니다.`;
        killedDiv.style.color = 'var(--accent-color)';
        resultsContent.appendChild(killedDiv);
    }
    
    if (!results.killed && !results.saved && !results.investigated && !results.jokerRevenge) {
        const noEventDiv = document.createElement('div');
        noEventDiv.textContent = '조용한 밤이었습니다.';
        noEventDiv.style.color = 'var(--text-light)';
        resultsContent.appendChild(noEventDiv);
    }
    
    resultsArea.classList.remove('hidden');
}

// 투표 결과 처리
function handleVotingResults(data) {
    console.log('VotingResults received:', data);
    const resultsArea = document.getElementById('resultsArea');
    const resultsContent = document.getElementById('resultsContent');

    // 구분선 추가 (이전 기록이 있다면)
    const needSeparator = resultsContent.children.length > 0;
    if (needSeparator) {
        const hr = document.createElement('hr');
        hr.className = 'result-separator';
        resultsContent.appendChild(hr);
    }
    
    if (data.eliminated) {
        const eliminatedPlayerName = getPlayerNameById(data.eliminated);
        const eliminatedDiv = document.createElement('div');
        eliminatedDiv.innerHTML = `🗳️ <strong>${eliminatedPlayerName}님</strong>이 투표로 처형되었습니다.`;
        eliminatedDiv.style.color = 'var(--warning-color)';
        resultsContent.appendChild(eliminatedDiv);
    } else {
        const noEliminationDiv = document.createElement('div');
        noEliminationDiv.textContent = '동점으로 아무도 처형되지 않았습니다.';
        noEliminationDiv.style.color = 'var(--text-light)';
        resultsContent.appendChild(noEliminationDiv);
    }

    // 후보별 득표 수 표시
    if (data.voteCounts && Array.isArray(data.voteCounts) && data.voteCounts.length > 0) {
        const countsHeader = document.createElement('div');
        countsHeader.textContent = '득표 현황:';
        countsHeader.style.fontWeight = 'bold';
        countsHeader.style.marginTop = '4px';
        resultsContent.appendChild(countsHeader);

        data.voteCounts.forEach(([targetId, count]) => {
            const targetName = getPlayerNameById(targetId);
            const countLine = document.createElement('div');
            countLine.textContent = `• ${targetName}: ${count}표`;
            resultsContent.appendChild(countLine);
        });
    }

    // 투표 공개인 경우, 각 플레이어의 투표 내역 표시
    if (data.votePublic && data.voteDetails && Array.isArray(data.voteDetails)) {
        const voteHeader = document.createElement('div');
        voteHeader.textContent = '투표 내역:';
        voteHeader.style.fontWeight = 'bold';
        voteHeader.style.marginTop = '4px';
        resultsContent.appendChild(voteHeader);
        
        if (data.voteDetails.length === 0) {
            const noneDiv = document.createElement('div');
            noneDiv.textContent = '투표 데이터가 없습니다.';
            resultsContent.appendChild(noneDiv);
        } else {
            data.voteDetails.forEach(([voterId, targetId]) => {
                const voterName = getPlayerNameById(voterId);
                const targetName = targetId ? getPlayerNameById(targetId) : '없음';
                
                // 정치인 투표인지 확인
                const isPoliticianVote = data.politicianVotes && 
                    data.politicianVotes.some(pv => pv.voter === voterId);
                
                const voteLine = document.createElement('div');
                if (isPoliticianVote) {
                    voteLine.textContent = `• ${voterName} → ${targetName} (1.5표)`;
                    voteLine.style.fontWeight = 'bold';
                    voteLine.style.color = 'var(--warning-color)';
                } else {
                    voteLine.textContent = `• ${voterName} → ${targetName}`;
                }
                resultsContent.appendChild(voteLine);
            });
        }
    }
    
    resultsArea.classList.remove('hidden');
}

// 플레이어 ID로 이름 찾기
function getPlayerNameById(playerId) {
    const allPlayers = [...currentPlayers, ...currentBots];
    const player = allPlayers.find(p => p.id === playerId);
    return player ? player.name : playerId;
}

// 현재 플레이어가 살아있는지 확인
function isCurrentPlayerAlive() {
    const allPlayers = [...currentPlayers, ...currentBots];
    const currentPlayer = allPlayers.find(p => p.id === socket.id);
    
    console.log('플레이어 생존 상태 확인:', { 
        socketId: socket?.id, 
        currentPlayer: currentPlayer ? { id: currentPlayer.id, name: currentPlayer.name, alive: currentPlayer.alive } : null,
        allPlayersCount: allPlayers.length
    });
    
    return currentPlayer ? currentPlayer.alive : false;
}

// 플레이어 상태에 따른 UI 업데이트
function updatePlayerUIBasedOnStatus() {
    const isAlive = isCurrentPlayerAlive();
    
    console.log('플레이어 상태 업데이트:', { isAlive, playerData });
    
    // 게임 채팅 입력 상태 업데이트
    const gameChatInput = document.getElementById('gameChatInput');
    const sendGameChatBtn = document.getElementById('sendGameChatBtn');
    
    if (!isAlive) {
        // 죽은 플레이어도 채팅은 가능
        if (gameChatInput) {
            gameChatInput.disabled = false;
            sendGameChatBtn.disabled = false;
            gameChatInput.placeholder = '사망자 전용 채팅...';
        }
        
        // 액션 버튼들은 비활성화
        const actionButtons = document.querySelectorAll('.action-btn');
        actionButtons.forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
        });
        
        // 대상 선택 버튼들도 비활성화
        const targetButtons = document.querySelectorAll('.target-btn');
        targetButtons.forEach(btn => {
            btn.style.pointerEvents = 'none';
            btn.style.opacity = '0.5';
        });
    } else {
        // 살아있는 플레이어는 UI 활성화
        const actionButtons = document.querySelectorAll('.action-btn');
        actionButtons.forEach(btn => {
            btn.disabled = false;
            btn.style.opacity = '1';
        });
        
        const targetButtons = document.querySelectorAll('.target-btn');
        targetButtons.forEach(btn => {
            btn.style.pointerEvents = 'auto';
            btn.style.opacity = '1';
        });
    }
}

// 게임 종료 처리
function handleGameEnd(data) {
    showScreen('gameEnd');
    
    const gameResult = document.getElementById('gameResult');
    const winnerTeam = document.getElementById('winnerTeam');
    
    if (data.winner === 'citizens') {
        gameResult.textContent = '시민팀 승리!';
        winnerTeam.textContent = '모든 마피아가 제거되었습니다!';
        winnerTeam.className = 'winner-team citizens';
    } else {
        gameResult.textContent = '마피아팀 승리!';
        winnerTeam.textContent = '마피아가 시민을 모두 제거했습니다!';
        winnerTeam.className = 'winner-team mafia';
    }
    
    // 최종 플레이어 상태 표시
    updateFinalPlayersList(data.players, data.bots);
}

// 최종 플레이어 목록 업데이트
function updateFinalPlayersList(players, bots) {
    const finalPlayersList = document.getElementById('finalPlayersList');
    finalPlayersList.innerHTML = '';
    
    [...players, ...bots].forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-item';
        if (!player.alive) playerDiv.classList.add('dead');
        
        const statusIcon = player.alive ? '✅' : '💀';
        const roleText = getRoleDisplayName(player.role);
        
        playerDiv.innerHTML = `
            <span>${statusIcon} <strong>${player.name}</strong></span>
            <span class="role-badge ${player.role}">${roleText}</span>
        `;
        
        finalPlayersList.appendChild(playerDiv);
    });
}

// 행동 확인 처리
function handleActionConfirmed(data) {
    console.log('액션 확인됨:', data);
    
    let toastMessage = '';
    let toastType = 'success';
    
    if (data.action === 'kill' && playerData?.role === 'mafia') {
        const targetName = getPlayerNameById(data.target);
        toastMessage = `🗡️ ${targetName}을(를) 공격 대상으로 선택했습니다!`;
    } else if (data.action === 'save') {
        const targetName = getPlayerNameById(data.target);
        toastMessage = `💚 ${targetName}을(를) 치료 대상으로 선택했습니다!`;
    } else if (data.action === 'investigate') {
        const targetName = getPlayerNameById(data.target);
        toastMessage = `🔍 ${targetName}을(를) 수사 대상으로 선택했습니다!`;
    } else if (data.action === 'swap') {
        const targetName = getPlayerNameById(data.target);
        toastMessage = `✨ ${targetName}과(와) 직업을 교환하기로 했습니다!`;
    } else if (data.action === 'vote') {
        const targetName = getPlayerNameById(data.target);
        toastMessage = `🗳️ ${targetName}에게 투표했습니다!`;
    } else {
        toastMessage = '행동이 선택되었습니다!';
    }
    
    // 알림 표시
    showToast(toastMessage, toastType, 4000);
    
    // 브라우저 알림도 표시
    if (Notification.permission === 'granted') {
        new Notification('마피아 게임', {
            body: toastMessage,
            icon: '/favicon.ico'
        });
    }
}

// 투표 확인 처리
function handleVoteConfirmed(data) {
    showToast('투표가 완료되었습니다.');
}

// 채팅 오류 처리
function handleChatError(data) {
    showToast(data.message);
}

// 투표 오류 처리
function handleVoteError(data) {
    showToast(data.message);
}

// 게임 리셋 처리
function handleGameReset(data) {
    // 플레이어 및 봇 정보 업데이트
    currentPlayers = data.players;
    currentBots = data.bots;

    // 게임 관련 상태 초기화
    playerData = null;
    gameState = null;
    selectedTarget = null;

    // 대기실 UI 업데이트
    updatePlayersList(currentPlayers, currentBots, data.maxPlayers);

    // 호스트 컨트롤 표시 여부 조정
    const hostControls = document.getElementById('hostControls');
    if (isHost) {
        hostControls.style.display = 'block';
    } else {
        hostControls.style.display = 'none';
    }

    // 화면을 대기실로 전환
    showScreen('waiting');

    // 결과/타이머 영역 초기화 (필요 시)
    const resultsArea = document.getElementById('resultsArea');
    if (resultsArea) resultsArea.classList.add('hidden');

    showToast('새 게임이 준비되었습니다!');
}

// 채팅 메시지 전송
function sendChatMessage() {
    const chatInput = document.getElementById('chatInput');
    const message = chatInput.value.trim();
    
    if (!message) return;
    
    socket.emit('chatMessage', { message });
    chatInput.value = '';
}

// 게임 채팅 메시지 전송
function sendGameChatMessage() {
    const chatInput = document.getElementById('gameChatInput');
    const message = chatInput.value.trim();
    
    if (!message || chatInput.disabled) return;
    
    socket.emit('chatMessage', { message });
    chatInput.value = '';
}

// 마피아 전용 채팅 메시지 전송
function sendMafiaChatMessage() {
    const chatInput = document.getElementById('mafiaChatInput');
    const message = chatInput.value.trim();
    
    if (!message || chatInput.disabled) return;
    
    socket.emit('mafiaChatMessage', { message });
    chatInput.value = '';
}

// 채팅 메시지 처리
function handleChatMessage(data) {
    const isGameScreen = screens.game.classList.contains('active');
    const messagesContainer = isGameScreen ? 
        document.getElementById('gameChatMessages') : 
        document.getElementById('chatMessages');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${data.type}`;
    
    if (data.type === 'system') {
        messageDiv.textContent = data.message;
    } else {
        const header = document.createElement('div');
        header.className = 'message-header';
        header.textContent = data.playerName;
        
        const content = document.createElement('div');
        content.textContent = data.message;
        
        messageDiv.appendChild(header);
        messageDiv.appendChild(content);
    }
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// 마피아 전용 채팅 메시지 처리
function handleMafiaChatMessage(data) {
    const messagesContainer = document.getElementById('mafiaChatMessages');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${data.type}`;
    
    const header = document.createElement('div');
    header.className = 'message-header';
    header.textContent = `🔴 ${data.playerName}`;
    
    const content = document.createElement('div');
    content.textContent = data.message;
    
    messageDiv.appendChild(header);
    messageDiv.appendChild(content);
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// 유틸리티 함수들
function showToast(message, type = 'info', duration = 3000) {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    const toastIcon = document.getElementById('toastIcon');
    
    toastMessage.textContent = message;
    toast.classList.remove('hidden');
    toast.classList.remove('success', 'error', 'warning', 'info', 'no-icon');
    toast.classList.add(type);

    if (type === 'success') {
        toastIcon.textContent = '';
        toast.classList.add('no-icon');
    } else if (type === 'error') {
        toastIcon.textContent = '❌';
        toast.classList.remove('no-icon');
    } else if (type === 'warning') {
        toastIcon.textContent = '⚠️';
        toast.classList.remove('no-icon');
    } else {
        toastIcon.textContent = '';
        toast.classList.add('no-icon');
    }
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, duration);
}

function showLoadingSpinner() {
    document.getElementById('loadingSpinner').classList.remove('hidden');
}

function hideLoadingSpinner() {
    document.getElementById('loadingSpinner').classList.add('hidden');
}

function showModal(title, message, showCancel = false) {
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalMessage = document.getElementById('modalMessage');
    const cancelBtn = document.getElementById('modalCancelBtn');
    
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    cancelBtn.style.display = showCancel ? 'block' : 'none';
    
    modal.classList.remove('hidden');
}

function hideModal() {
    document.getElementById('modal').classList.add('hidden');
}

// 키보드 단축키
document.addEventListener('keydown', (e) => {
    // ESC 키로 모달 닫기
    if (e.key === 'Escape') {
        hideModal();
        hideGameGuide();
    }
});

// 반응형 처리를 위한 resize 이벤트
window.addEventListener('resize', () => {
    // 채팅 스크롤 위치 조정
    const chatContainers = document.querySelectorAll('.chat-messages');
    chatContainers.forEach(container => {
        container.scrollTop = container.scrollHeight;
    });
});

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
    if (socket) {
        socket.disconnect();
    }
});

// 방 목록 새로고침
function refreshRoomList() {
    socket.emit('getRoomList');
}

// 닉네임 복사 및 채팅창에 붙여넣기 함수
function copyNicknameToChat(nickname) {
    try {
        // 클립보드에 복사
        navigator.clipboard.writeText(nickname).then(() => {
            console.log('닉네임이 클립보드에 복사되었습니다:', nickname);
        }).catch(err => {
            console.log('클립보드 복사 실패:', err);
        });
        
        // 현재 화면에 따라 적절한 채팅 입력창 찾기
        let chatInput = null;
        
        if (screens.waiting.classList.contains('active')) {
            // 대기실 화면
            chatInput = document.getElementById('chatInput');
        } else if (screens.game.classList.contains('active')) {
            // 게임 화면 - 일반 채팅 입력창
            chatInput = document.getElementById('gameChatInput');
        }
        
        // 채팅 입력창에 닉네임 붙여넣기
        if (chatInput && !chatInput.disabled) {
            const currentValue = chatInput.value;
            const newValue = currentValue ? `${currentValue} ${nickname}` : nickname;
            chatInput.value = newValue;
            chatInput.focus();
            
            // 커서를 맨 끝으로 이동
            chatInput.setSelectionRange(newValue.length, newValue.length);
        }
        
        // 성공 알림 표시
        showToast(`${nickname} 닉네임 복사완료!`, 'success', 2000);
        
    } catch (error) {
        console.error('닉네임 복사 중 오류 발생:', error);
        showToast('닉네임 복사에 실패했습니다.', 'error', 2000);
    }
}

// 방 목록 처리
function handleRoomList(rooms) {
    const roomList = document.getElementById('roomList');
    
    if (rooms.length === 0) {
        roomList.innerHTML = '<div class="no-rooms">아직 생성된 방이 없습니다.</div>';
        return;
    }
    
    roomList.innerHTML = '';
    
    rooms.forEach(room => {
        const roomItem = document.createElement('div');
        const statusClass = room.gameStarted ? 'playing' : (room.canJoin ? 'available' : 'full');
        roomItem.className = `room-item ${statusClass}`;
        
        // 게임 상태에 따른 상태 텍스트와 아이콘
        let statusText = '';
        let statusIcon = '';
        
        if (room.gameStarted) {
            statusText = '플레이중';
            statusIcon = '🎮';
        } else if (room.canJoin) {
            statusText = '참가 가능';
            statusIcon = '✅';
        } else {
            statusText = '인원 초과';
            statusIcon = '❌';
        }
        
        roomItem.innerHTML = `
            <div class="room-info">
                <div class="room-name">방: ${room.roomCode}</div>
                <div class="room-details">
                    <div class="room-host">
                        <span>👑</span>
                        <span>${room.hostName}</span>
                    </div>
                    <div class="room-players">
                        <span>👥</span>
                        <span>${room.currentPlayers}/${room.maxPlayers}</span>
                    </div>
                    <div class="room-game-status">
                        <span>${statusIcon}</span>
                        <span>${room.gameStatus}</span>
                    </div>
                </div>
            </div>
            <div class="room-status ${statusClass}">
                ${statusText}
            </div>
        `;
        
        if (room.canJoin) {
            roomItem.addEventListener('click', () => {
                document.getElementById('roomCodeInput').value = room.roomCode;
                joinRoom();
            });
        } else if (room.gameStarted) {
            // 플레이 중인 방은 클릭할 수 없지만 비활성화 상태로 표시
            roomItem.style.cursor = 'not-allowed';
            roomItem.title = '게임이 진행 중인 방입니다';
        }
        
        roomList.appendChild(roomItem);
    });
}

// 페이지 새로고침(F5, Ctrl+R) 방지 (대기실/게임 중)
window.addEventListener('keydown', (e) => {
    const isRefreshKey = (e.key === 'F5') || (e.key.toLowerCase() === 'r' && (e.ctrlKey || e.metaKey));
    if (isRefreshKey) {
        const isInRoom = screens.waiting.classList.contains('active') || screens.game.classList.contains('active');
        if (isInRoom) {
            e.preventDefault();
            showToast('게임 중에는 새로고침을 할 수 없습니다.');
        }
    }
});

// 마피아 팀 행동 알림 처리
function handleMafiaTeamAction(data) {
    showToast(`🔴 ${data.actor}가 ${data.target}을 죽이기로 했습니다.`);
}

// 투표 공개 설정 업데이트
function handleVoteVisibilityUpdated(data) {
    const voteVisibilitySelect = document.getElementById('voteVisibilitySelect');
    if (voteVisibilitySelect) {
        voteVisibilitySelect.value = data.votePublic ? 'public' : 'private';
    }
    const msg = data.votePublic ? '투표가 공개로 설정되었습니다.' : '투표가 비공개로 설정되었습니다.';
    showToast(msg);
}

// === 오디오 설정 ===
function setupAudio() {
    // Web Audio API로 클릭 사운드 생성
    let audioContext;
    let clickBuffer;

    const createClickSound = () => {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        const sampleRate = audioContext.sampleRate;
        const duration = 0.1; // 100ms
        const samples = sampleRate * duration;
        
        clickBuffer = audioContext.createBuffer(1, samples, sampleRate);
        const data = clickBuffer.getChannelData(0);
        
        // 클릭 사운드 생성 (짧은 비프음)
        for (let i = 0; i < samples; i++) {
            const t = i / sampleRate;
            const frequency = 800 * Math.exp(-t * 10); // 주파수 감쇠
            const amplitude = Math.exp(-t * 20); // 진폭 감쇠
            data[i] = Math.sin(2 * Math.PI * frequency * t) * amplitude * 0.3;
        }
    };

    const playClickSound = () => {
        if (!audioContext || !clickBuffer) return;
        
        const source = audioContext.createBufferSource();
        const gainNode = audioContext.createGain();
        
        source.buffer = clickBuffer;
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        gainNode.gain.value = 0.1;
        
        source.start();
    };

    // 사용자 상호작용 시 오디오 컨텍스트 활성화
    const startAudio = () => {
        createClickSound();
        playClickSound();
    };

    ['pointerdown', 'click', 'touchstart'].forEach(evt => {
        document.body.addEventListener(evt, startAudio, { 
            capture: true, 
            passive: true,
            once: false
        });
    });
}

// === 테마 업데이트 ===
function updateTheme(phase) {
    const body = document.body;
    if (phase === 'night') {
        body.classList.remove('theme-light'); // 어두운 테마 유지
    } else {
        body.classList.add('theme-light');
    }
}

// 봇 추가 오류 이벤트 처리
function handleBotAddError(data) {
    showToast(data.message);
}

// === 역할 설명 시스템 ===

// 역할별 설명 데이터 [[memory:3183747]]
const roleDescriptions = {
    'mafia': {
        icon: '🔴',
        title: '마피아',
        team: '마피아팀',
        goal: '모든 시민을 제거하여 마피아가 시민과 같거나 많아지게 하세요.',
        ability: '밤이 되면, 마피아 팀원들과 함께 살아있는 시민 한 명을 지목하여 제거할 수 있습니다.',
        tip: '낮에는 시민인 척 연기하고, 밤에는 팀원들과 협력하여 시민을 제거하세요. 너무 적극적으로 행동하면 의심받을 수 있어요.'
    },
    'police': {
        icon: '👮',
        title: '경찰',
        team: '시민팀',
        goal: '마피아를 찾아내 시민들을 승리로 이끄세요.',
        ability: '밤이 되면, 살아있는 사람 한 명을 지목하여 그 사람이 \'마피아\'인지 아닌지 확인할 수 있습니다.',
        tip: '당신의 정보는 매우 강력해요. 정체를 너무 빨리 밝히면 마피아의 첫 번째 목표가 될 수 있으니 조심하세요.'
    },
    'doctor': {
        icon: '⚕️',
        title: '의사',
        team: '시민팀',
        goal: '시민들을 치료하여 마피아의 공격으로부터 보호하세요.',
        ability: '밤이 되면, 살아있는 사람 한 명을 지목하여 마피아의 공격으로부터 보호할 수 있습니다.',
        tip: '중요한 역할을 가진 사람을 보호하세요. 자신을 치료할 수는 없지만, 때로는 예상 밖의 사람을 구해서 마피아를 혼란에 빠뜨릴 수도 있어요.'
    },
    'citizen': {
        icon: '👥',
        title: '시민',
        team: '시민팀',
        goal: '마피아를 찾아내 모두 제거하세요.',
        ability: '특별한 능력은 없지만, 토론과 투표로 마피아를 찾아낼 수 있습니다.',
        tip: '당신은 게임의 핵심이에요. 다른 플레이어들의 행동을 잘 관찰하고, 논리적으로 추리하여 마피아를 찾아내세요.'
    },
    'wizard': {
        icon: '🧙',
        title: '마법사',
        team: '시민팀',
        goal: '시민팀의 승리를 위해 전략적으로 역할을 교환하세요.',
        ability: '밤이 되면, 다른 플레이어와 역할을 교환할 수 있습니다. 성공하면 상대방은 시민이 되고, 당신은 상대방의 역할을 얻습니다.',
        tip: '마피아와 역할을 교환하면 큰 이득을 얻을 수 있어요. 하지만 실패하거나 잘못된 대상을 선택하면 팀에 손해가 될 수 있으니 신중하게 선택하세요.'
    },
    'joker': {
        icon: '🃏',
        title: '조커',
        team: '시민팀 (변동 가능)',
        goal: '시민으로 끝까지 살아남아 마피아를 찾아내거나, 마피아의 공격을 유도하여 새로운 마피아가 되어 시민을 없애세요.',
        ability: '마피아에게 공격당하면 반격하여 공격한 마피아 중 한 명을 같이 죽이고 자신은 마피아가 됩니다.',
        tip: '두 가지 승리 조건이 있어요. 시민으로 끝까지 살아남거나, 마피아의 공격을 받아 마피아가 되어 시민팀을 배신할 수 있습니다.'
    },
    'shaman': {
        icon: '🔮',
        title: '무당',
        team: '시민팀',
        goal: '죽은 자들의 정보를 활용하여 시민팀을 승리로 이끄세요.',
        ability: '밤이 되면, 죽은 플레이어 한 명을 지목하여 그 사람의 역할을 확인할 수 있습니다.',
        tip: '죽은 플레이어들의 역할을 파악하여 살아있는 마피아가 누구인지 추리하세요. 정보를 현명하게 활용하면 게임을 뒤바꿀 수 있어요.'
    },
    'politician': {
        icon: '🏛️',
        title: '정치인',
        team: '시민팀',
        goal: '영향력을 행사하여 시민팀을 승리로 이끄세요.',
        ability: '투표 시 당신의 표는 1.5표로 계산됩니다.',
        tip: '당신의 투표는 더 큰 영향력을 가져요. 신중하게 투표하여 시민팀에게 유리한 결과를 만들어내세요.'
    }
};

// 역할 설명 툴팁 설정
function setupRoleTooltip(roleElement, role) {
    let tooltip = null;
    let hoverTimeout = null;
    let autoHideTimeout = null;

    const showTooltip = () => {
        // 이미 툴팁이 표시되어 있으면 리턴
        const existingTooltip = document.querySelector('.role-tooltip.show');
        if (existingTooltip) return;
        
        // 기존 툴팁 제거
        hideTooltip();
        
        const description = roleDescriptions[role];
        if (!description) return;

        // 배경 오버레이 생성
        const overlay = document.createElement('div');
        overlay.className = 'role-tooltip-overlay';
        
        // 툴팁 생성
        tooltip = document.createElement('div');
        tooltip.className = 'role-tooltip';
        
        tooltip.innerHTML = `
            <div class="role-tooltip-header">
                <span class="role-tooltip-icon">${description.icon}</span>
                <span class="role-tooltip-title">${description.title}</span>
                <span class="role-tooltip-team">${description.team}</span>
                <button class="role-tooltip-close">✕</button>
            </div>
            <div class="role-tooltip-section">
                <span class="role-tooltip-label">목표</span>
                <div class="role-tooltip-content">${description.goal}</div>
            </div>
            <div class="role-tooltip-section">
                <span class="role-tooltip-label">능력</span>
                <div class="role-tooltip-content">${description.ability}</div>
            </div>
            <div class="role-tooltip-section">
                <div class="role-tooltip-tip">💡 ${description.tip}</div>
            </div>
        `;

        // 닫기 버튼 이벤트 추가
        const closeBtn = tooltip.querySelector('.role-tooltip-close');
        closeBtn.addEventListener('click', hideTooltip);
        
        // 오버레이 클릭 시 닫기
        overlay.addEventListener('click', hideTooltip);
        
        // ESC 키로 닫기
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                hideTooltip();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        // body에 추가
        document.body.appendChild(overlay);
        document.body.appendChild(tooltip);
        
        // 애니메이션을 위해 약간의 지연 후 show 클래스 추가
        setTimeout(() => {
            if (overlay && tooltip) {
                overlay.classList.add('show');
                tooltip.classList.add('show');
            }
        }, 10);

        // 호버로 열린 툴팁은 4초 후 자동으로 닫힘
        autoHideTimeout = setTimeout(() => {
            hideTooltip();
        }, 4000);
    };

    const hideTooltip = () => {
        // 타이머 정리
        if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
        }
        if (autoHideTimeout) {
            clearTimeout(autoHideTimeout);
            autoHideTimeout = null;
        }

        const currentOverlay = document.querySelector('.role-tooltip-overlay');
        const currentTooltip = document.querySelector('.role-tooltip');
        
        if (currentOverlay) currentOverlay.classList.remove('show');
        if (currentTooltip) currentTooltip.classList.remove('show');
        
        setTimeout(() => {
            if (currentOverlay && currentOverlay.parentNode) {
                currentOverlay.parentNode.removeChild(currentOverlay);
            }
            if (currentTooltip && currentTooltip.parentNode) {
                currentTooltip.parentNode.removeChild(currentTooltip);
            }
            tooltip = null;
        }, 300);
    };

    // 마우스 호버 이벤트 (지연 후 표시)
    roleElement.addEventListener('mouseenter', () => {
        // 기존 타이머 취소
        if (hoverTimeout) {
            clearTimeout(hoverTimeout);
        }
        
        // 0.5초 후에 툴팁 표시
        hoverTimeout = setTimeout(() => {
            showTooltip();
        }, 500);
    });

    roleElement.addEventListener('mouseleave', () => {
        // 호버 타이머 취소 (툴팁이 아직 표시되지 않았다면)
        if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
        }
    });

    // 클릭 이벤트 (즉시 토글)
    roleElement.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // 호버 타이머 취소
        if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
        }
        
        // 현재 표시된 툴팁이 있는지 확인
        const currentTooltip = document.querySelector('.role-tooltip.show');
        
        if (currentTooltip) {
            hideTooltip();
        } else {
            showTooltip();
        }
    });


}

// 게임 가이드 모달 표시
function showGameGuide() {
    const gameGuideModal = document.getElementById('gameGuideModal');
    gameGuideModal.classList.remove('hidden');
    
    // 모달 오버레이 클릭 시 닫기
    gameGuideModal.addEventListener('click', (e) => {
        if (e.target === gameGuideModal) {
            hideGameGuide();
        }
    });
}

// 게임 가이드 모달 숨기기
function hideGameGuide() {
    const gameGuideModal = document.getElementById('gameGuideModal');
    gameGuideModal.classList.add('hidden');
} 