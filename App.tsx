import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Atom, Send, Image as ImageIcon, Music, BookOpen, Monitor, LogIn, LogOut, Loader as Loader2, Palette, Download, CreditCard as Edit2, ImagePlus, X, Menu, Plus, MessageCircle, History, Zap, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, getDoc, setDoc, updateDoc, limit } from 'firebase/firestore';
import { GoogleGenAI, Modality } from "@google/genai";

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const Typewriter = ({ text, animate = true, onComplete }: { text: string; animate?: boolean; onComplete?: () => void }) => {
  const chars = useMemo(() => text.split(''), [text]);
  
  if (!animate) return <span>{text}</span>;

  return (
    <motion.div className="inline">
      {chars.map((char, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            duration: 0.05,
            delay: i * 0.015, // Blazing fast character typing
            ease: "linear"
          }}
          onAnimationComplete={i === chars.length - 1 ? onComplete : undefined}
        >
          {char}
        </motion.span>
      ))}
    </motion.div>
  );
};

const JarvisLoader = ({ color }: { color: string }) => (
  <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 backdrop-blur-md rounded-full border border-white/10 shadow-xl">
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
      className="flex items-center justify-center"
    >
      <Atom size={16} style={{ color }} />
    </motion.div>
    <div className="flex gap-0.5">
        {[0,1,2].map(i => (
            <motion.div 
                key={i}
                animate={{ opacity: [0.2, 1, 0.2] }}
                transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                className="w-1 h-1 rounded-full"
                style={{ backgroundColor: color }}
            />
        ))}
    </div>
  </div>
);

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeMode, setActiveMode] = useState<'chat' | 'image' | 'music'>('chat');
  const [themeSettings, setThemeSettings] = useState({
    primary: '#ef4444',
    secondary: '#f59e0b',
    useGradient: false,
    opacity: 0.5
  });
  const [userName, setUserName] = useState('User');
  const [userPfp, setUserPfp] = useState('https://picsum.photos/seed/user/100/100');
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [showApiKeyPrompt, setShowApiKeyPrompt] = useState(false);
  const [chats, setChats] = useState<any[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    setPersistence(auth, browserLocalPersistence);
    return onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setMessages([]);
      if (currentUser) {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserName(data.userName || currentUser.displayName || 'User');
          setUserPfp(data.userPfp || currentUser.photoURL || 'https://picsum.photos/seed/user/100/100');
          if (data.themeSettings) {
            setThemeSettings(data.themeSettings);
          } else if (data.themeColor) {
            // Migration from old string-based theme
            const COLOR_MAP: Record<string, string> = {
                red: '#ef4444', blue: '#3b82f6', green: '#22c55e', amber: '#f59e0b',
                purple: '#a855f7', cyan: '#06b6d4', pink: '#ec4899', indigo: '#6366f1'
            };
            setThemeSettings(prev => ({ ...prev, primary: COLOR_MAP[data.themeColor] || '#ef4444' }));
          }
        }
      }
    });
  }, []);

  useEffect(() => {
    if (user) {
      const chatsRef = collection(db, 'users', user.uid, 'chats');
      const q = query(chatsRef, orderBy('updatedAt', 'desc'));
      return onSnapshot(q, (snapshot) => {
        setChats(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
    } else {
      setChats([]);
      setCurrentChatId(null);
    }
  }, [user]);

  useEffect(() => {
    if (user && currentChatId) {
      const messagesRef = collection(db, 'users', user.uid, 'chats', currentChatId, 'messages');
      const q = query(messagesRef, orderBy('createdAt', 'asc'));
      return onSnapshot(q, (snapshot) => {
        setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
    } else {
      setMessages([]);
    }
  }, [user, currentChatId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const compressImage = (base64: string, maxWidth = 800): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const MAX_WIDTH = maxWidth;
        let width = img.width;
        let height = img.height;
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = () => resolve(base64);
    });
  };

  const handleImageAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setAttachedImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSend = async () => {
    const currentInput = input.trim();
    if (!currentInput && !attachedImage) return;

    setIsLoading(true);
    let chatId = currentChatId;

    try {
      // Create new chat if none selected
      if (!chatId && user) {
        const newChatRef = await addDoc(collection(db, 'users', user.uid, 'chats'), {
            title: 'New Chat',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        chatId = newChatRef.id;
        setCurrentChatId(chatId);
      }

      // Check if we need a selected API key for this mode
      if (activeMode === 'music') {
         try {
           const hasKey = await window.aistudio.hasSelectedApiKey();
           if (!hasKey) {
              setShowApiKeyPrompt(true);
              setIsLoading(false);
              return;
           }
         } catch (keyError) {
           console.error("Key selection check failed:", keyError);
           // Fallback to showing prompt if check fails
           setShowApiKeyPrompt(true);
           setIsLoading(false);
           return;
         }
      }
      
      const userMsg: any = {
        text: `${activeMode !== 'chat' ? `[${activeMode.toUpperCase()} MODE] ` : ''}${currentInput}`,
        senderId: user?.uid || 'guest',
        senderEmail: user?.email || 'Guest',
        createdAt: serverTimestamp()
      };

      if (attachedImage) {
          let finalUserImg = attachedImage;
          if (finalUserImg.length > 500 * 1024) {
              finalUserImg = await compressImage(finalUserImg);
          }
          userMsg.imageUrl = finalUserImg;
      }

      setInput('');
      const currentAttached = attachedImage;
      setAttachedImage(null);
      setMessages(prev => [...prev, { ...userMsg, id: Date.now() }]);

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });
      let responseMsg: any = { senderId: 'jarvis', senderEmail: 'Jarvis', createdAt: serverTimestamp() };
      
      if (currentAttached) {
        // Image Editing / Analysis Mode
        const mimeType = currentAttached.split(';')[0].split(':')[1];
        const base64Data = currentAttached.split(',')[1];
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [
                    { inlineData: { data: base64Data, mimeType } },
                    { text: currentInput || "What is in this image? or remix it if requested." }
                ]
            }
        });

        let foundImage = false;
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                responseMsg.text = "Here is the edited image:";
                responseMsg.imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                foundImage = true;
            } else if (part.text) {
                responseMsg.text = part.text;
            }
        }
        if (!foundImage && !responseMsg.text) {
            responseMsg.text = "I processed the image but didn't generate a new one. How else can I help?";
        }

      } else if (activeMode === 'image') {
        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash-image', contents: currentInput });
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            responseMsg.text = "Generated Image:";
            responseMsg.imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          }
        }
      } else if (activeMode === 'music') {
        const culturalContext = "Please generate music that is respectful and aware of the user's cultural and religious background. Ensure the tone is appropriate for the prompt's context.";
        const enhancedPrompt = `${culturalContext}\n\nUser request: ${currentInput}`;
        
        const customMusicKey = process.env.MUSIC_API_KEY || process.env.API_KEY || process.env.GEMINI_API_KEY;
        const musicAi = new GoogleGenAI({ apiKey: customMusicKey || '' });

        const response = await musicAi.models.generateContentStream({ 
            model: "lyria-3-clip-preview", 
            contents: enhancedPrompt,
            config: {
                responseModalities: [Modality.AUDIO]
            }
        });
        let audioBase64 = "";
        let mimeType = "audio/wav";
        for await (const chunk of response) {
          const parts = chunk.candidates?.[0]?.content?.parts;
          if (parts) {
            for (const part of parts) {
                if (part.inlineData?.data) {
                    if (!audioBase64) mimeType = part.inlineData.mimeType || mimeType;
                    audioBase64 += part.inlineData.data;
                }
            }
          }
        }

        if (!audioBase64) {
            throw new Error("No audio data generated (Check if your API key has Lyria access)");
        }

        const binary = atob(audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mimeType });
        const audioUrl = URL.createObjectURL(blob);

        responseMsg.text = "Generated Music:";
        responseMsg.audioUrl = audioUrl;
      } else {
        const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: `You are Jarvis, a helpful assistant. User says: ${currentInput}` });
        responseMsg.text = response.text || "I'm not sure how to respond to that.";
      }
      
      const jarvisId = Date.now() + 1;
      setMessages(prev => [...prev, { ...responseMsg, id: jarvisId }]);
      
      if (user && chatId) {
        try {
          const responseToSave = { ...responseMsg };
          if (responseToSave.imageUrl && responseToSave.imageUrl.length > 500 * 1024) {
             responseToSave.imageUrl = await compressImage(responseToSave.imageUrl);
          }
          const serialized = JSON.stringify(responseToSave);
          if (serialized.length > 900 * 1024) {
             delete responseToSave.imageUrl;
             delete responseToSave.audioUrl;
             responseToSave.text += " (File too large for history, saved locally only)";
          }
          await addDoc(collection(db, 'users', user.uid, 'chats', chatId, 'messages'), userMsg);
          await addDoc(collection(db, 'users', user.uid, 'chats', chatId, 'messages'), responseToSave);
          await updateDoc(doc(db, 'users', user.uid, 'chats', chatId), {
              updatedAt: serverTimestamp()
          });

          // Generate title if it's the first message
          if (messages.length === 0) {
              const titleResponse = await ai.models.generateContent({
                  model: 'gemini-3-flash-preview',
                  contents: `Generate a very short title (max 5 words) for a chat that starts with this user prompt: "${currentInput}". Return ONLY the title text.`
              });
              const title = titleResponse.text.replace(/["']/g, '').trim() || 'New Chat';
              await updateDoc(doc(db, 'users', user.uid, 'chats', chatId), { title });
          }
        } catch (dbError) {
          console.error("Failed to save to Firestore:", dbError);
        }
      }
    } catch (e: any) {
      console.error(e);
      let errorText = "Sorry, I encountered an error. Please try again.";
      if (e.message?.includes("PERMISSION_DENIED") || e.message?.includes("403")) {
          errorText = "Access Denied: Please ensure you have selected a valid API key with the required AI feature permissions.";
          setShowApiKeyPrompt(true);
      } else if (e.message?.includes("404")) {
          errorText = "Model not found. This feature might not be available in your region.";
      }
      setMessages(prev => [...prev, { text: errorText, senderId: 'jarvis', senderEmail: 'Jarvis', createdAt: serverTimestamp() }]);
    } finally {
      setIsLoading(false);
      setActiveMode('chat');
    }
  };

  const handleSelectApiKey = async () => {
    await window.aistudio.openSelectKey();
    setShowApiKeyPrompt(false);
  };

  const downloadFile = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const compressed = await compressImage(reader.result as string, 400);
        setUserPfp(compressed);
      };
      reader.readAsDataURL(file);
    }
  };

  const saveProfile = async () => {
    if (user) {
      setIsLoading(true);
      try {
        let pfpToSave = userPfp;
        // Last-mile compression check
        if (pfpToSave.length > 500 * 1024) {
          pfpToSave = await compressImage(pfpToSave, 300);
        }
        
        await setDoc(doc(db, 'users', user.uid), { 
            userName, 
            userPfp: pfpToSave, 
            themeSettings 
        }, { merge: true });
        setIsProfileModalOpen(false);
      } catch (err) {
        console.error("Profile save failed:", err);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const saveTheme = async () => {
    setIsThemeModalOpen(false);
    if (user) await setDoc(doc(db, 'users', user.uid), { themeSettings }, { merge: true });
  };
  
  const handleLogin = () => signInWithPopup(auth, googleProvider);
  const handleLogout = () => {
    signOut(auth);
    setCurrentChatId(null);
  };
  
  const startNewChat = () => {
    setCurrentChatId(null);
    setMessages([]);
  };

  return (
    <div 
        className={`min-h-screen flex w-full bg-slate-950 text-slate-100 font-sans overflow-hidden`}
        style={{
            '--theme-primary': themeSettings.primary,
            '--theme-secondary': themeSettings.useGradient ? themeSettings.secondary : themeSettings.primary,
            '--theme-opacity': themeSettings.opacity,
        } as React.CSSProperties}
    >
      {isThemeModalOpen && (
        <div className="fixed inset-0 z-[200] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold mb-6 text-white border-b border-white/10 pb-2">Customize Theme</h2>
            
            <div className="space-y-6">
                {/* Primary Color */}
                <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Primary Color</label>
                    <div className="flex items-center gap-4">
                        <input 
                            type="color" 
                            value={themeSettings.primary} 
                            onChange={(e) => setThemeSettings(prev => ({...prev, primary: e.target.value}))}
                            className="w-12 h-12 rounded-lg bg-transparent border-none cursor-pointer"
                        />
                        <input 
                            type="text" 
                            value={themeSettings.primary}
                            onChange={(e) => setThemeSettings(prev => ({...prev, primary: e.target.value}))}
                            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm w-32 focus:border-[var(--theme-primary)] outline-none"
                        />
                    </div>
                </div>

                {/* Gradient Toggle */}
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-400">Enable Gradient</span>
                    <button 
                        onClick={() => setThemeSettings(prev => ({...prev, useGradient: !prev.useGradient}))}
                        className={`w-12 h-6 rounded-full transition-colors relative ${themeSettings.useGradient ? 'bg-green-600' : 'bg-slate-700'}`}
                    >
                        <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${themeSettings.useGradient ? 'translate-x-6' : ''}`}></div>
                    </button>
                </div>

                {/* Secondary Color (Conditional) */}
                {themeSettings.useGradient && (
                    <div className="animate-in fade-in slide-in-from-top-2">
                        <label className="block text-sm font-medium text-slate-400 mb-2">Secondary Color (Gradient End)</label>
                        <div className="flex items-center gap-4">
                            <input 
                                type="color" 
                                value={themeSettings.secondary} 
                                onChange={(e) => setThemeSettings(prev => ({...prev, secondary: e.target.value}))}
                                className="w-12 h-12 rounded-lg bg-transparent border-none cursor-pointer"
                            />
                            <input 
                                type="text" 
                                value={themeSettings.secondary}
                                onChange={(e) => setThemeSettings(prev => ({...prev, secondary: e.target.value}))}
                                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm w-32 focus:border-[var(--theme-secondary)] outline-none"
                            />
                        </div>
                    </div>
                )}

                {/* Opacity Slider */}
                <div>
                    <div className="flex justify-between mb-2">
                        <label className="text-sm font-medium text-slate-400">Theme Opacity</label>
                        <span className="text-sm font-mono text-white">{Math.round(themeSettings.opacity * 100)}%</span>
                    </div>
                    <input 
                        type="range" 
                        min="0" 
                        max="1" 
                        step="0.01" 
                        value={themeSettings.opacity}
                        onChange={(e) => setThemeSettings(prev => ({...prev, opacity: parseFloat(e.target.value)}))}
                        className="w-full accent-[var(--theme-primary)]"
                    />
                </div>

                {/* Preview */}
                <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Preview</label>
                    <div 
                        className="h-12 rounded-xl border border-white/10 flex items-center justify-center text-xs font-bold uppercase tracking-widest"
                        style={{ 
                            background: themeSettings.useGradient 
                                ? `linear-gradient(to right, ${themeSettings.primary}, ${themeSettings.secondary})` 
                                : themeSettings.primary,
                            opacity: themeSettings.opacity 
                        }}
                    >
                        Jarvis Style
                    </div>
                </div>

                {/* Save Button */}
                <button 
                    onClick={saveTheme} 
                    className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-green-500/20 transition-all uppercase tracking-widest"
                >
                    Save Theme
                </button>
                <button 
                    onClick={() => setIsThemeModalOpen(false)}
                    className="w-full text-slate-500 hover:text-white text-sm"
                >
                    Cancel
                </button>
            </div>
          </div>
        </div>
      )}
      {showApiKeyPrompt && (
        <div className="fixed inset-0 z-[300] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 text-center">
            <div className="bg-slate-900 border border-red-500/30 rounded-2xl p-8 w-full max-w-md shadow-2xl">
                <Music className="w-16 h-16 text-red-500 mx-auto mb-6 animate-pulse" />
                <h2 className="text-2xl font-bold mb-4 text-white uppercase tracking-wider">API Key Required</h2>
                <p className="text-slate-400 mb-8 leading-relaxed">
                    To generate high-quality AI music (Lyria), you need to select your own Gemini API key from a paid Google Cloud project.
                </p>
                <div className="flex flex-col gap-3">
                    <button 
                        onClick={handleSelectApiKey}
                        className="w-full py-4 bg-red-600 hover:bg-red-500 text-white rounded-xl font-black text-lg shadow-lg hover:shadow-red-500/20 transition-all uppercase tracking-widest"
                    >
                        Select API Key
                    </button>
                    <a 
                        href="https://ai.google.dev/gemini-api/docs/billing" 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-xs text-slate-500 hover:text-slate-300 underline"
                    >
                        Learn about Gemini API billing
                    </a>
                    <button 
                        onClick={() => setShowApiKeyPrompt(false)}
                        className="mt-2 text-slate-500 hover:text-white text-sm"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
      )}
      {isProfileModalOpen && (
        <div className="fixed inset-0 z-[200] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold mb-4 text-white">Edit Profile</h2>
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="relative group">
                  <img src={userPfp} alt="" className="w-20 h-20 rounded-full object-cover border-2 border-slate-700" />
                  <label className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity"><Edit2 size={24} className="text-white" /><input type="file" accept="image/*" onChange={handleFileChange} className="hidden" /></label>
                </div>
              </div>
              <input value={userName} onChange={(e) => setUserName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-[var(--theme-primary)] transition-colors" placeholder="Username" />
              <button onClick={saveProfile} className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-2 rounded-lg transition-colors">Save Changes</button>
              <button onClick={() => setIsProfileModalOpen(false)} className="w-full text-slate-400 hover:text-white">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside 
        className={`${isSidebarOpen ? 'w-64 sm:w-72' : 'w-0'} transition-all duration-300 bg-slate-900 border-r border-white/5 flex flex-col h-screen shrink-0 relative z-50`}
      >
        <div className="p-4 border-b border-white/5 flex items-center justify-between overflow-hidden whitespace-nowrap">
            <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5" style={{ color: themeSettings.primary }} />
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="hover:text-white text-slate-500 sm:hidden"><X size={20}/></button>
        </div>

        <button 
            onClick={startNewChat}
            className="m-4 flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-white/10 hover:border-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/5 transition-all text-sm font-medium overflow-hidden whitespace-nowrap"
        >
            <Plus size={18} style={{ color: themeSettings.primary }} />
            <span>New Conversation</span>
        </button>

        <div className="flex-1 overflow-y-auto px-2 space-y-1 pb-20">
            {chats.map((chat) => (
                <button
                    key={chat.id}
                    onClick={() => setCurrentChatId(chat.id)}
                    className={`w-full text-left p-3 rounded-xl transition-all flex items-center gap-3 group relative overflow-hidden ${currentChatId === chat.id ? 'bg-[var(--theme-primary)]/10 text-white' : 'hover:bg-white/5 text-slate-400'}`}
                >
                    <MessageCircle size={16} className={currentChatId === chat.id ? '' : 'text-slate-600'} style={currentChatId === chat.id ? { color: themeSettings.primary } : {}} />
                    <span className="truncate text-sm flex-1">{chat.title || 'Untitled Chat'}</span>
                    {currentChatId === chat.id && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full" style={{ backgroundColor: themeSettings.primary }}></div>
                    )}
                </button>
            ))}
            {chats.length === 0 && user && (
                <div className="text-center py-10 opacity-30 px-4">
                    <History className="w-10 h-10 mx-auto mb-2" />
                    <p className="text-xs">No recent history</p>
                </div>
            )}
            {!user && (
                <div className="text-center py-10 px-4">
                    <p className="text-xs text-slate-500">Login to save your conversations</p>
                </div>
            )}
        </div>

        {user && (
            <div className="p-4 border-t border-white/5 bg-slate-900/50 backdrop-blur-md overflow-hidden whitespace-nowrap">
                <div className="flex items-center gap-3">
                    <img src={userPfp} alt="" className="w-8 h-8 rounded-full border border-white/10 shadow-lg" />
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate text-white uppercase tracking-wider">{userName}</p>
                        <p className="text-[10px] text-slate-500 truncate">{user?.email}</p>
                    </div>
                </div>
            </div>
        )}
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen relative">
        {/* Mobile Sidebar Overlay */}
        {isSidebarOpen && (
            <div 
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[45] sm:hidden"
                onClick={() => setIsSidebarOpen(false)}
            />
        )}
        
        <header 
            className="border-b sticky top-0 z-40 backdrop-blur-md bg-slate-950/80 w-full"
            style={{ borderColor: `${themeSettings.primary}44` }}
        >
            <div className="w-full max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
                {!isSidebarOpen && (
                    <button 
                        onClick={() => setIsSidebarOpen(true)}
                        className="p-2 -ml-2 text-slate-400 hover:text-white transition-all hover:scale-110 active:scale-95 flex items-center justify-center"
                        title="Open Chat History"
                    >
                        <History size={20} />
                    </button>
                )}
                <div className="flex items-center gap-3">
                    <Atom 
                        className="w-8 h-8 animate-pulse shrink-0" 
                        style={{ color: themeSettings.primary }}
                    />
                    <h1 className="text-2xl font-bold tracking-tighter text-white">JARVIS</h1>
                </div>
            </div>
            <div className="flex items-center gap-4">
                {user ? (
                <>
                    <button 
                        onClick={() => setIsThemeModalOpen(true)} 
                        className="p-2 text-slate-400 hover:text-white transition-colors"
                    >
                        <Palette size={20} style={{ color: themeSettings.primary }} />
                    </button>
                    <div onClick={() => setIsProfileModalOpen(true)} className="flex items-center gap-2 cursor-pointer group">
                        <img src={userPfp} alt={userName} className="w-8 h-8 rounded-full object-cover border border-slate-700 group-hover:border-[var(--theme-primary)] transition-colors" />
                    </div>
                    <button onClick={handleLogout} className="text-slate-400 hover:text-white shrink-0"><LogOut size={20}/></button>
                </>
                ) : (
                    <button 
                        onClick={handleLogin} 
                        className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold text-white shrink-0 transition-opacity hover:opacity-90 shadow-lg"
                        style={{ backgroundColor: themeSettings.primary }}
                    >
                        <LogIn size={16}/>Login
                    </button>
                )}
            </div>
            </div>
        </header>

        <div 
            className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[var(--theme-primary)] via-slate-950 to-black z-0 pointer-events-none"
            style={{ opacity: themeSettings.opacity }}
        ></div>

        <main className="flex-1 flex flex-col w-full max-w-5xl mx-auto p-4 min-h-0 relative z-10">
            <div className="flex-1 overflow-y-auto mb-4 space-y-4 pr-1">
                {messages.length === 0 && !isLoading && (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-6 animate-in fade-in zoom-in duration-500">
                        <Atom className="w-20 h-20 animate-pulse text-[var(--theme-primary)] opacity-50" />
                        <div>
                            <h2 className="text-3xl font-black italic tracking-tighter text-white uppercase">How can I assist you today?</h2>
                            <p className="text-slate-500 mt-2 text-sm max-w-xs mx-auto">Jarvis is ready for chat, image generation, or music production.</p>
                        </div>
                        <div className="flex flex-wrap justify-center gap-2">
                            {['Create a cool lo-fi beat', 'Generate a futuristic city', 'Solve a complex riddle'].map(tip => (
                                <button 
                                    key={tip} 
                                    onClick={() => setInput(tip)}
                                    className="px-4 py-2 rounded-full border border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all text-xs text-slate-300"
                                >
                                    {tip}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {messages.map((msg: any, index: number) => (
                    <div 
                        key={msg.id || index} 
                        className={`p-3 rounded-xl min-w-0 flex flex-col gap-2 border ${msg.senderId === user?.uid ? 'self-end ml-auto' : 'bg-slate-800 self-start border-slate-700'}`}
                        style={msg.senderId === user?.uid ? { 
                            backgroundColor: `${themeSettings.primary}22`,
                            borderColor: `${themeSettings.primary}44`
                        } : {}}
                    >
                        <div>
                            <p className="text-xs text-slate-400 mb-1 truncate">{msg.senderEmail}</p>
                            <div className="text-sm sm:text-base break-words">
                                {msg.senderId === 'jarvis' ? (
                                    <Typewriter 
                                        text={msg.text} 
                                        animate={index === messages.length - 1 && !msg.audioUrl && !msg.imageUrl} 
                                    />
                                ) : (
                                    msg.text
                                )}
                            </div>
                        </div>
                        {msg.imageUrl && (
                            <div className="flex flex-col gap-2">
                                <img src={msg.imageUrl} alt="Generated" className="rounded-lg max-w-full shadow-lg border border-white/5" />
                                <div className="flex items-center gap-2">
                                    <button 
                                        onClick={() => downloadFile(msg.imageUrl, 'jarvis-image.png')}
                                        className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white transition-colors"
                                        title="Download"
                                    >
                                        <Download size={16} />
                                    </button>
                                    <button 
                                        onClick={() => {
                                            setActiveMode('image');
                                            setInput("Edit this image: ");
                                        }}
                                        className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white transition-colors flex items-center gap-2 text-xs font-bold"
                                        title="Edit Image"
                                    >
                                        <Edit2 size={16} /> Edit
                                    </button>
                                </div>
                            </div>
                        )}
                        {msg.audioUrl && (
                            <div className="flex flex-col gap-2">
                                <audio controls src={msg.audioUrl} className="w-full" />
                                <button 
                                    onClick={() => downloadFile(msg.audioUrl, 'jarvis-audio.wav')}
                                    className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white transition-colors self-start"
                                    title="Download"
                                >
                                    <Download size={16} />
                                </button>
                            </div>
                        )}
                    </div>
                ))}
                {isLoading && (
                    <div className="self-start py-2">
                        <JarvisLoader color={themeSettings.primary} />
                    </div>
                )}
                <div ref={chatEndRef} />
            </div>
            
            {attachedImage && (
                <div className="relative w-24 h-24 mb-2 ml-4 group">
                    <img src={attachedImage} className="w-full h-full object-cover rounded-lg border-2" style={{ borderColor: themeSettings.primary }} alt="Attached" />
                    <button 
                        onClick={() => setAttachedImage(null)}
                        className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-1 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-2 flex items-center gap-1 sm:gap-2 shrink-0">
            <label className="p-2 shrink-0 text-slate-500 hover:text-[var(--theme-primary)] cursor-pointer">
                <ImagePlus size={20}/>
                <input type="file" accept="image/*" onChange={handleImageAttachment} className="hidden" />
            </label>
            <button 
                onClick={() => setActiveMode(prev => prev === 'image' ? 'chat' : 'image')} 
                className="p-2 shrink-0 transition-colors"
                style={{ color: activeMode === 'image' ? themeSettings.primary : '#64748b' }}
            >
                <ImageIcon size={20}/>
            </button>
            <button 
                onClick={() => setActiveMode(prev => prev === 'music' ? 'chat' : 'music')} 
                className="p-2 shrink-0 transition-colors"
                style={{ color: activeMode === 'music' ? themeSettings.primary : '#64748b' }}
            >
                <Music size={20}/>
            </button>
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleSend()} className="flex-1 bg-transparent outline-none p-2 text-sm sm:text-base min-w-0" placeholder={activeMode === 'chat' ? "Talk to Jarvis..." : `Generate ${activeMode}...`} />
            <button 
                onClick={handleSend} 
                className="p-2 rounded-xl text-white shrink-0 shadow-lg transition-transform active:scale-95"
                style={{ backgroundColor: themeSettings.primary }}
            >
                <Send size={20}/>
            </button>
            </div>
        </main>
      </div>
    </div>
  );
};

export default App;
