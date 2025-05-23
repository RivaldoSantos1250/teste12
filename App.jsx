import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, updateDoc, arrayUnion, collection, serverTimestamp, addDoc, query, orderBy, limit, getDoc } from 'firebase/firestore';
import { Play, Pause, Send, Users, Link as LinkIcon, LogIn, PlusCircle, CheckCircle, XCircle, MessageSquare, Settings, Film, Sparkles, Loader2, Lightbulb, BotMessageSquare } from 'lucide-react';

// Variáveis globais do ambiente (serão injetadas pelo Canvas)
const firebaseConfigJson = typeof __firebase_config !== 'undefined' ? __firebase_config : '{}';
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-watch-party-app-gemini'; // Alterado para novo ID se necessário
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

const firebaseConfig = JSON.parse(firebaseConfigJson);

// Inicialização do Firebase
let app;
let auth;
let db;

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
} catch (error) {
    console.error("Erro ao inicializar Firebase:", error);
}

const SYNC_THRESHOLD = 1.5; // Segundos de diferença para forçar a sincronização do seek
const GEMINI_API_KEY = ""; // Deixe em branco, o Canvas injetará em runtime

// Componente Modal Genérico
const Modal = ({ isOpen, onClose, title, children, size = "md" }) => {
    if (!isOpen) return null;
    const sizeClasses = {
        sm: "max-w-sm",
        md: "max-w-md",
        lg: "max-w-lg",
        xl: "max-w-xl"
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
            <div className={`bg-gray-800 p-6 rounded-lg shadow-xl w-full ${sizeClasses[size]} text-white`}>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-semibold">{title}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <XCircle size={24} />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
};

// Componente Principal App
function App() {
    const [currentUser, setCurrentUser] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [roomIdFromInput, setRoomIdFromInput] = useState(''); // Renomeado para evitar conflito
    const [currentRoomId, setCurrentRoomId] = useState(''); // Estado para o ID da sala atual
    const [displayName, setDisplayName] = useState('');
    const [enteredRoom, setEnteredRoom] = useState(false);
    const [showNameModal, setShowNameModal] = useState(false);
    const [nameInput, setNameInput] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (!auth) {
            setError("Firebase Auth não inicializado.");
            return;
        }
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setCurrentUser(user);
                const uId = user.uid || crypto.randomUUID();
                setUserId(uId);
                const storedName = localStorage.getItem(`displayName-${uId}`);
                if (storedName) {
                    setDisplayName(storedName);
                    setShowNameModal(false);
                } else {
                    setShowNameModal(true);
                }
            } else {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(auth, initialAuthToken);
                    } else {
                        await signInAnonymously(auth);
                    }
                } catch (authError) {
                    console.error("Erro no login:", authError);
                    setError("Falha na autenticação. Tente recarregar a página.");
                }
            }
            setIsAuthReady(true);
        });
        return () => unsubscribe();
    }, []);

    const handleNameSubmit = () => {
        if (nameInput.trim()) {
            setDisplayName(nameInput.trim());
            if (userId) {
                localStorage.setItem(`displayName-${userId}`, nameInput.trim());
            }
            setShowNameModal(false);
            setError('');
        } else {
            setError("Por favor, insira um nome de exibição.");
        }
    };

    const createRoom = async () => {
        if (!db || !userId || !displayName) {
            setError("Aguarde a inicialização ou defina um nome de exibição.");
            return;
        }
        const newRoomId = crypto.randomUUID().slice(0, 8);
        const roomRef = doc(db, `artifacts/${appId}/public/data/watchPartyRooms`, newRoomId);
        try {
            await setDoc(roomRef, {
                id: newRoomId,
                currentVideoUrl: '',
                isPlaying: false,
                currentTime: 0,
                hostId: userId,
                createdAt: serverTimestamp(),
                participants: {
                    [userId]: { displayName, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() }
                }
            });
            setCurrentRoomId(newRoomId); // Atualiza o ID da sala atual
            setEnteredRoom(true);
            setError('');
        } catch (e) {
            console.error("Erro ao criar sala:", e);
            setError("Falha ao criar sala. Tente novamente.");
        }
    };

    const joinRoom = async () => { // Modificado para usar roomIdFromInput
        if (!db || !userId || !displayName) {
            setError("Aguarde a inicialização ou defina um nome de exibição.");
            return;
        }
        if (!roomIdFromInput.trim()) {
            setError("Por favor, insira um ID de sala.");
            return;
        }
        const roomRef = doc(db, `artifacts/${appId}/public/data/watchPartyRooms`, roomIdFromInput);
        try {
            const roomSnap = await getDoc(roomRef);
            if (roomSnap.exists()) {
                await updateDoc(roomRef, {
                    [`participants.${userId}`]: { displayName, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() }
                });
                setCurrentRoomId(roomIdFromInput); // Atualiza o ID da sala atual
                setEnteredRoom(true);
                setError('');
            } else {
                setError("Sala não encontrada.");
            }
        } catch (e) {
            console.error("Erro ao entrar na sala:", e);
            setError("Falha ao entrar na sala. Verifique o ID e tente novamente.");
        }
    };

    if (!isAuthReady) {
        return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white"><div className="animate-pulse">Carregando autenticação...</div></div>;
    }
    
    if (showNameModal && isAuthReady && userId) {
        return (
            <Modal isOpen={showNameModal} onClose={() => { if(displayName) setShowNameModal(false) }} title="Defina seu Nome de Exibição">
                <div className="space-y-4">
                    <input
                        type="text"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        placeholder="Seu nome"
                        className="w-full p-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:border-indigo-500"
                    />
                    {error && <p className="text-red-400 text-sm">{error}</p>}
                    <button
                        onClick={handleNameSubmit}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded-lg flex items-center justify-center"
                    >
                        <CheckCircle size={20} className="mr-2" /> Salvar Nome
                    </button>
                </div>
            </Modal>
        );
    }


    if (!enteredRoom || !currentRoomId || !displayName) {
        return (
            <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
                <header className="mb-12 text-center">
                    <h1 className="text-5xl font-bold text-indigo-400 mb-2 flex items-center justify-center">
                        <Film size={48} className="mr-3" /> CineSync <Sparkles size={30} className="ml-2 text-yellow-400" />
                    </h1>
                    <p className="text-xl text-gray-400">Assista vídeos com amigos, em perfeita sincronia e com IA!</p>
                    {userId && <p className="text-sm text-gray-500 mt-2">Seu ID de Usuário: {userId}</p>}
                </header>
                
                {error && <div className="bg-red-500 text-white p-3 rounded-md mb-6 max-w-md w-full text-center">{error}</div>}

                <div className="bg-gray-800 p-8 rounded-xl shadow-2xl w-full max-w-md">
                    <div className="mb-6">
                        <button
                            onClick={createRoom}
                            disabled={!userId || !displayName}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center text-lg transition-colors duration-150"
                        >
                            <PlusCircle size={22} className="mr-2" /> Criar Nova Sala
                        </button>
                        {!displayName && <p className="text-xs text-yellow-400 mt-1 text-center">Defina seu nome para criar uma sala.</p>}
                    </div>

                    <div className="text-center text-gray-400 my-4">OU</div>

                    <div>
                        <h2 className="text-xl font-semibold mb-3 text-center">Entrar em uma Sala Existente</h2>
                        <input
                            type="text"
                            placeholder="Digite o ID da Sala"
                            value={roomIdFromInput} // Controlado pelo estado
                            onChange={(e) => setRoomIdFromInput(e.target.value)}
                            className="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 focus:outline-none focus:border-indigo-500 mb-3"
                        />
                        <button
                            onClick={joinRoom} // Modificado para não passar argumento
                            disabled={!userId || !displayName}
                            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center text-lg transition-colors duration-150"
                        >
                            <LogIn size={22} className="mr-2" /> Entrar na Sala
                        </button>
                        {!displayName && <p className="text-xs text-yellow-400 mt-1 text-center">Defina seu nome para entrar em uma sala.</p>}
                    </div>
                </div>
                 <footer className="mt-12 text-center text-gray-500 text-sm">
                    <p>&copy; {new Date().getFullYear()} CineSync. Desenvolvido para fins demonstrativos.</p>
                    <p>App ID: {appId}</p>
                </footer>
            </div>
        );
    }

    return <Room roomId={currentRoomId} userId={userId} displayName={displayName} onLeave={() => {setEnteredRoom(false); setCurrentRoomId('');}} />;
}

// Componente Room
function Room({ roomId, userId, displayName, onLeave }) {
    const [roomData, setRoomData] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [videoUrlInput, setVideoUrlInput] = useState('');
    const videoRef = useRef(null);
    const [isSeeking, setIsSeeking] = useState(false);
    const [error, setError] = useState('');
    const lastFirestoreUpdateTimeRef = useRef(0);

    // Estados para Gemini API
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [summary, setSummary] = useState('');
    const [showSummaryModal, setShowSummaryModal] = useState(false);
    const [isSuggestingComment, setIsSuggestingComment] = useState(false);
    const [suggestedComment, setSuggestedComment] = useState('');
    const [geminiError, setGeminiError] = useState('');

    const roomRef = doc(db, `artifacts/${appId}/public/data/watchPartyRooms`, roomId);
    const chatRef = collection(db, `artifacts/${appId}/public/data/watchPartyRooms/${roomId}/chat`);

    useEffect(() => {
        const unsubscribeRoom = onSnapshot(roomRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setRoomData(data);
                if (videoRef.current && data.currentVideoUrl && videoRef.current.src !== data.currentVideoUrl) {
                    videoRef.current.src = data.currentVideoUrl;
                    videoRef.current.load();
                }
            } else {
                setError("Sala não encontrada ou foi excluída.");
                onLeave();
            }
        }, (err) => {
            console.error("Erro ao ouvir dados da sala:", err);
            setError("Erro de conexão com a sala.");
        });

        const q = query(chatRef, orderBy('timestamp', 'asc'), limit(100)); // Aumentado limite de chat
        const unsubscribeChat = onSnapshot(q, (querySnapshot) => {
            const messages = [];
            querySnapshot.forEach((doc) => {
                messages.push({ id: doc.id, ...doc.data() });
            });
            setChatMessages(messages);
        }, (err) => {
            console.error("Erro ao ouvir chat:", err);
        });
        
        const intervalId = setInterval(async () => {
            if (userId && roomId) {
                try {
                    await updateDoc(roomRef, {
                        [`participants.${userId}.lastSeen`]: serverTimestamp()
                    });
                } catch (e) {
                    console.warn("Falha ao atualizar lastSeen:", e);
                }
            }
        }, 30000);


        return () => {
            unsubscribeRoom();
            unsubscribeChat();
            clearInterval(intervalId);
        };
    }, [roomId, userId, onLeave]); // Adicionado onLeave

    useEffect(() => {
        if (!videoRef.current || !roomData) return;
        const player = videoRef.current;
        const { isPlaying, currentTime, lastSeekTime } = roomData;

        if (roomData.currentVideoUrl && player.src !== roomData.currentVideoUrl) {
            player.src = roomData.currentVideoUrl;
            player.load();
        }
        
        if (isPlaying && player.paused) {
            player.play().catch(e => console.warn("Erro ao tentar dar play automático:", e));
        } else if (!isPlaying && !player.paused) {
            player.pause();
        }

        const targetTime = lastSeekTime !== undefined ? lastSeekTime : currentTime;
        if (targetTime !== undefined && Math.abs(player.currentTime - targetTime) > SYNC_THRESHOLD && !isSeeking) {
             // Apenas sincroniza se não estiver buscando localmente, para evitar conflitos
            player.currentTime = targetTime;
        }

    }, [roomData, isSeeking]); // Removido videoRef.current, adicionado isSeeking

    const handlePlayerAction = useCallback(async (action) => {
        if (!roomData || !videoRef.current) return;
        const player = videoRef.current;
        let updatePayload = {};

        switch (action.type) {
            case 'PLAY':
                updatePayload = { isPlaying: true, currentTime: player.currentTime, hostId: userId };
                break;
            case 'PAUSE':
                updatePayload = { isPlaying: false, currentTime: player.currentTime, hostId: userId };
                break;
            case 'SEEK':
                updatePayload = { currentTime: action.payload.time, lastSeekTime: action.payload.time, isPlaying: !player.paused, hostId: userId };
                break;
            case 'CHANGE_VIDEO':
                if (!action.payload.url.trim()) {
                    setError("URL do vídeo não pode ser vazia.");
                    return;
                }
                updatePayload = { 
                    currentVideoUrl: action.payload.url, 
                    isPlaying: false, 
                    currentTime: 0,
                    lastSeekTime: 0,
                    hostId: userId 
                };
                setVideoUrlInput('');
                break;
            default: return;
        }
        
        if (Object.keys(updatePayload).length > 0) {
            try {
                await updateDoc(roomRef, updatePayload);
                setError('');
            } catch (e) {
                console.error("Erro ao atualizar estado da sala:", e);
                setError("Falha ao sincronizar ação. Verifique sua conexão.");
            }
        }
    }, [roomData, userId, roomRef]);


    const onPlay = () => handlePlayerAction({ type: 'PLAY' });
    const onPause = () => handlePlayerAction({ type: 'PAUSE' });
    
    const onSeeked = () => {
      if (videoRef.current && isSeeking) {
        handlePlayerAction({ type: 'SEEK', payload: { time: videoRef.current.currentTime } });
        setIsSeeking(false); 
      }
    };
    const onSeeking = () => {
        if (videoRef.current) { // Só marca como seeking se o player existir
            setIsSeeking(true);
        }
    };
    
    const onTimeUpdate = () => {
        if (videoRef.current && roomData && roomData.hostId === userId && !videoRef.current.paused && !isSeeking) {
            const now = Date.now();
            if (now - lastFirestoreUpdateTimeRef.current > 5000) { 
                updateDoc(roomRef, { currentTime: videoRef.current.currentTime })
                    .then(() => lastFirestoreUpdateTimeRef.current = now)
                    .catch(e => console.warn("Falha ao atualizar currentTime periodicamente:", e));
            }
        }
    };

    const handleVideoUrlChange = () => {
        if (videoUrlInput) {
            handlePlayerAction({ type: 'CHANGE_VIDEO', payload: { url: videoUrlInput } });
        }
    };

    const sendChatMessage = async () => {
        if (!newMessage.trim()) return;
        try {
            await addDoc(chatRef, {
                userId,
                displayName,
                text: newMessage,
                timestamp: serverTimestamp()
            });
            setNewMessage('');
            setSuggestedComment(''); // Limpa sugestão após enviar mensagem
        } catch (e) {
            console.error("Erro ao enviar mensagem:", e);
            setError("Falha ao enviar mensagem.");
        }
    };

    // Funções Gemini
    const callGeminiAPI = async (prompt) => {
        setGeminiError('');
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const payload = {
            contents: [{ role: "user", parts: [{ text: prompt }] }]
        };

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const errorData = await response.json();
                console.error("Erro da API Gemini:", errorData);
                throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
            }
            const result = await response.json();
            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                return result.candidates[0].content.parts[0].text;
            } else {
                console.error("Resposta inesperada da API Gemini:", result);
                throw new Error("Formato de resposta inesperado da API Gemini.");
            }
        } catch (error) {
            console.error("Falha ao chamar API Gemini:", error);
            setGeminiError(`Erro Gemini: ${error.message}`);
            return null;
        }
    };

    const handleGenerateSummary = async () => {
        if (chatMessages.length === 0) {
            setGeminiError("Não há mensagens no chat para resumir.");
            return;
        }
        setIsSummarizing(true);
        setSummary('');
        const formattedChatHistory = chatMessages
            .map(msg => `${msg.displayName || msg.userId}: ${msg.text}`)
            .join("\n");
        const prompt = `Você é um assistente de resumo de chat. Por favor, resuma a seguinte conversa de uma watch party de forma concisa e informativa em Português Brasileiro:\n\n${formattedChatHistory}\n\nResumo:`;
        
        const result = await callGeminiAPI(prompt);
        if (result) {
            setSummary(result);
            setShowSummaryModal(true);
        }
        setIsSummarizing(false);
    };

    const handleSuggestComment = async () => {
        setIsSuggestingComment(true);
        setSuggestedComment('');
        const lastMessages = chatMessages.slice(-5).map(msg => `${msg.displayName || msg.userId}: ${msg.text}`).join("\n");
        let prompt = `Você é um assistente de chat divertido e criativo para uma watch party. Os usuários estão assistindo a um vídeo juntos. Sugira um comentário curto (1-2 frases), espirituoso e relevante para adicionar à conversa, em Português Brasileiro.`;
        if (lastMessages) {
            prompt += `\n\nContexto das últimas mensagens (opcional):\n${lastMessages}`;
        }
        prompt += `\n\nSugestão de comentário:`;

        const result = await callGeminiAPI(prompt);
        if (result) {
            setSuggestedComment(result);
        }
        setIsSuggestingComment(false);
    };


    const currentHostId = roomData?.hostId;
    const isCurrentUserHost = userId === currentHostId;

    const participantsArray = roomData?.participants ? Object.entries(roomData.participants)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')) : [];

    if (!roomData) {
        return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">Carregando dados da sala...</div>;
    }
    
    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col p-4 md:p-6 lg:p-8 space-y-6">
            <header className="flex flex-col sm:flex-row justify-between items-center pb-4 border-b border-gray-700">
                <div>
                    <h1 className="text-3xl font-bold text-indigo-400">Sala: <span className="text-green-400">{roomId}</span></h1>
                    <p className="text-sm text-gray-400">Seu ID de Usuário: {userId} ({displayName})</p>
                    {currentHostId && <p className="text-sm text-gray-500">Host atual: {roomData?.participants?.[currentHostId]?.displayName || currentHostId} {isCurrentUserHost ? "(Você)" : ""}</p>}
                </div>
                <button
                    onClick={onLeave}
                    className="mt-4 sm:mt-0 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg flex items-center"
                >
                    <XCircle size={20} className="mr-2" /> Sair da Sala
                </button>
            </header>

            {error && <div className="bg-red-500 text-white p-3 rounded-md text-center mb-4">{error}</div>}
            {geminiError && <div className="bg-yellow-500 text-black p-3 rounded-md text-center mb-4">{geminiError}</div>}


            <div className="flex flex-col lg:flex-row gap-6 flex-grow min-h-0">
                {/* Player e Controles */}
                <div className="lg:w-2/3 bg-gray-800 p-4 md:p-6 rounded-lg shadow-xl flex flex-col">
                    <div className="aspect-video bg-black rounded-md overflow-hidden mb-4">
                        <video
                            ref={videoRef}
                            className="w-full h-full"
                            controls
                            onPlay={onPlay}
                            onPause={onPause}
                            onSeeked={onSeeked}
                            onSeeking={onSeeking}
                            onTimeUpdate={onTimeUpdate}
                            onError={(e) => {
                                console.error("Erro no player de vídeo:", e);
                                setError(`Erro ao carregar vídeo. Verifique a URL e o formato. (${e.target.error?.message || 'Detalhes indisponíveis'})`);
                            }}
                        >
                            {roomData?.currentVideoUrl ? 
                                <source src={roomData.currentVideoUrl} /> : 
                                <p className="text-center p-4">Nenhum vídeo carregado. Insira uma URL abaixo.</p>
                            }
                            Seu navegador não suporta o elemento de vídeo.
                        </video>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 items-center mb-4">
                        <input
                            type="text"
                            value={videoUrlInput}
                            onChange={(e) => setVideoUrlInput(e.target.value)}
                            placeholder="URL do vídeo (.mp4, .webm, etc.)"
                            className="flex-grow p-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:border-indigo-500"
                        />
                        <button
                            onClick={handleVideoUrlChange}
                            className="w-full sm:w-auto bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-2 px-4 rounded-lg flex items-center justify-center"
                        >
                            <LinkIcon size={18} className="mr-2" /> Carregar Vídeo
                        </button>
                    </div>
                </div>

                {/* Chat e Participantes */}
                <div className="lg:w-1/3 bg-gray-800 p-4 md:p-6 rounded-lg shadow-xl flex flex-col min-h-0 h-[60vh] lg:h-auto">
                    <div className="mb-4">
                        <h3 className="text-xl font-semibold mb-2 flex items-center"><Users size={22} className="mr-2 text-indigo-400"/>Participantes ({participantsArray.length})</h3>
                        <div className="max-h-32 overflow-y-auto bg-gray-700 p-2 rounded-md space-y-1">
                            {participantsArray.map(p => (
                                <div key={p.id} className={`text-sm p-1 rounded ${p.id === userId ? 'bg-indigo-600 text-white' : 'bg-gray-600'}`}>
                                    {p.displayName || p.id} {p.id === currentHostId ? <span className="text-xs opacity-75">(Host)</span> : ''}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-xl font-semibold flex items-center"><MessageSquare size={22} className="mr-2 text-indigo-400"/>Chat</h3>
                        <button
                            onClick={handleGenerateSummary}
                            disabled={isSummarizing || chatMessages.length === 0}
                            className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold py-1 px-3 rounded-lg text-sm flex items-center"
                            title="Gerar resumo da conversa com IA"
                        >
                            {isSummarizing ? <Loader2 size={18} className="animate-spin mr-1" /> : <BotMessageSquare size={18} className="mr-1" />}
                            Resumo ✨
                        </button>
                    </div>
                    <div className="flex-grow bg-gray-700 p-3 rounded-md overflow-y-auto mb-3 min-h-[150px] lg:min-h-0">
                        {chatMessages.length === 0 && <p className="text-gray-400 text-sm text-center">Nenhuma mensagem ainda.</p>}
                        {chatMessages.map(msg => (
                            <div key={msg.id} className={`mb-2 p-2 rounded-lg max-w-[85%] ${msg.userId === userId ? 'bg-indigo-600 ml-auto text-right' : 'bg-gray-600 mr-auto text-left'}`}>
                                <p className="font-semibold text-xs opacity-80">{msg.displayName || msg.userId}{msg.userId === userId ? ' (Você)' : ''}</p>
                                <p className="text-sm break-words">{msg.text}</p>
                                <p className="text-xs opacity-60 mt-1">
                                    {msg.timestamp?.toDate ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Enviando...'}
                                </p>
                            </div>
                        ))}
                    </div>
                    
                    {suggestedComment && (
                        <div className="mb-2 p-2 bg-green-700 rounded-md text-sm">
                            <div className="flex justify-between items-start">
                                <div>
                                    <strong className="flex items-center"><Lightbulb size={16} className="mr-1 text-yellow-300"/> Sugestão IA:</strong>
                                    <p className="italic ml-1">{suggestedComment}</p>
                                </div>
                                <button onClick={() => setSuggestedComment('')} className="text-green-200 hover:text-white text-xs"><XCircle size={16}/></button>
                            </div>
                             <button 
                                onClick={() => { setNewMessage(suggestedComment); setSuggestedComment(''); }}
                                className="mt-1 text-xs bg-green-500 hover:bg-green-400 px-2 py-0.5 rounded"
                            >
                                Usar esta sugestão
                            </button>
                        </div>
                    )}

                    <div className="flex gap-2 items-center">
                        <input
                            type="text"
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                            placeholder="Digite sua mensagem..."
                            className="flex-grow p-2 rounded bg-gray-600 border border-gray-500 focus:outline-none focus:border-indigo-500"
                        />
                         <button
                            onClick={handleSuggestComment}
                            disabled={isSuggestingComment}
                            className="bg-teal-500 hover:bg-teal-600 disabled:bg-gray-600 text-white font-semibold p-2 rounded-lg flex items-center justify-center"
                            title="Sugerir comentário com IA"
                            aria-label="Sugerir comentário"
                        >
                            {isSuggestingComment ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
                        </button>
                        <button
                            onClick={sendChatMessage}
                            className="bg-indigo-500 hover:bg-indigo-600 text-white font-semibold p-2 rounded-lg"
                            aria-label="Enviar mensagem"
                        >
                            <Send size={20} />
                        </button>
                    </div>
                </div>
            </div>
             <footer className="mt-auto pt-6 text-center text-gray-500 text-sm border-t border-gray-700">
                <p>App ID: {appId}</p>
            </footer>

            <Modal isOpen={showSummaryModal} onClose={() => setShowSummaryModal(false)} title="✨ Resumo da Conversa (IA)" size="lg">
                {isSummarizing && <div className="flex justify-center items-center p-4"><Loader2 size={32} className="animate-spin text-indigo-400"/> <span className="ml-2">Gerando resumo...</span></div>}
                {!isSummarizing && summary && <div className="whitespace-pre-wrap max-h-[60vh] overflow-y-auto p-2 bg-gray-700 rounded">{summary}</div>}
                {!isSummarizing && !summary && <p>Não foi possível gerar o resumo.</p>}
            </Modal>
        </div>
    );
}

export default App;

