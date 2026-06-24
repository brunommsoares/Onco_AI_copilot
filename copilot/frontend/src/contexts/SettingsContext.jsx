import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, dbSilver } from '../services/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

const SettingsContext = createContext();

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState({
    // Appearance
    theme: "light",
    fontSize: "medium",
    compactMode: false,
    
    // Chat Behavior
    typingSpeed: "normal",
    autoSave: true,
    showTimestamps: true,
    markdownRendering: true,
    
    // Notifications
    emailNotifications: false,
    browserNotifications: false,
    
    // Privacy
    dataCollection: true,
    shareAnalytics: false,
    
    // Language & Region
    language: "pt",
    responseStyle: "systematic_review",
    fastMode: false,
    dateFormat: "pt-PT",
    
    // Advanced
    apiTimeout: 30,
    maxConversationLength: 100,
    autoDeleteOldChats: false,
    autoDeleteDays: 30,
  });

  const [loading, setLoading] = useState(true);

  // Funções para aplicar configurações
  const applyTheme = () => {
    document.documentElement.classList.remove("dark");
    document.body.classList.remove("dark");
  };

  const applyFontSize = (size) => {
    try {
      const sizes = {
        small: "text-sm",
        medium: "text-base", 
        large: "text-lg",
        "extra-large": "text-xl"
      };
      
      // Remove classes anteriores
      document.body.classList.remove("text-sm", "text-base", "text-lg", "text-xl");
      // Adiciona nova classe
      if (sizes[size]) {
        document.body.classList.add(sizes[size]);
      }
    } catch (err) {
      console.error('Erro ao aplicar tamanho da fonte:', err);
    }
  };

  const applyCompactMode = (compact) => {
    try {
      if (compact) {
        document.body.classList.add("compact-mode");
      } else {
        document.body.classList.remove("compact-mode");
      }
    } catch (err) {
      console.error('Erro ao aplicar modo compacto:', err);
    }
  };

  const applySetting = (key, value) => {
    switch (key) {
      case 'theme':
        applyTheme(value);
        break;
      case 'fontSize':
        applyFontSize(value);
        break;
      case 'compactMode':
        applyCompactMode(value);
        break;
      default:
        break;
    }
  };

  // Carregar configurações do localStorage primeiro
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem('userSettings');
      if (savedSettings) {
        const parsedSettings = JSON.parse(savedSettings);
        setSettings(prev => ({ ...prev, ...parsedSettings }));
      }
    } catch (err) {
      console.error('Erro ao carregar configurações do localStorage:', err);
    }
  }, []);

  // Carregar configurações do Firestore quando usuário estiver autenticado
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          const settingsDoc = await getDoc(doc(dbSilver, "settings", user.uid));
          if (settingsDoc.exists()) {
            const firestoreSettings = settingsDoc.data();
            setSettings(prev => ({ ...prev, ...firestoreSettings }));
            
            // Atualizar localStorage
            localStorage.setItem('userSettings', JSON.stringify({ ...settings, ...firestoreSettings }));
          }
        }
      } catch (err) {
        console.error('Erro ao carregar configurações do Firestore:', err);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const updateSetting = (key, value) => {
    setSettings(prev => {
      const newSettings = { ...prev, [key]: value };
      
      // Aplicar mudanças imediatamente
      applySetting(key, value);
      
      // Salvar no localStorage
      try {
        localStorage.setItem('userSettings', JSON.stringify(newSettings));
      } catch (err) {
        console.error('Erro ao salvar no localStorage:', err);
      }
      
      return newSettings;
    });
  };

  const saveSettingsToFirestore = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return false;

      await setDoc(doc(dbSilver, "settings", user.uid), {
        ...settings,
        updatedAt: new Date(),
      }, { merge: true });
      
      return true;
    } catch (err) {
      console.error('Erro ao salvar configurações no Firestore:', err);
      return false;
    }
  };

  const resetSettings = () => {
    const defaultSettings = {
      theme: "light",
      fontSize: "medium",
      compactMode: false,
      typingSpeed: "normal",
      autoSave: true,
      showTimestamps: true,
      markdownRendering: true,
      emailNotifications: false,
      browserNotifications: false,
      dataCollection: true,
      shareAnalytics: false,
      language: "pt",
      responseStyle: "systematic_review",
      fastMode: false,
      dateFormat: "pt-PT",
      apiTimeout: 30,
      maxConversationLength: 100,
      autoDeleteOldChats: false,
      autoDeleteDays: 30,
    };
    
    setSettings(defaultSettings);
    
    // Aplicar configurações padrão
    applyTheme("light");
    applyFontSize("medium");
    applyCompactMode(false);
    
    // Salvar no localStorage
    try {
      localStorage.setItem('userSettings', JSON.stringify(defaultSettings));
    } catch (err) {
      console.error('Erro ao salvar configurações padrão:', err);
    }
  };

  // Aplicar configurações iniciais quando settings mudar
  useEffect(() => {
    if (!loading) {
      applyTheme(settings.theme);
      applyFontSize(settings.fontSize);
      applyCompactMode(settings.compactMode);
    }
  }, [settings.theme, settings.fontSize, settings.compactMode, loading]);

  const value = {
    settings,
    updateSetting,
    saveSettingsToFirestore,
    resetSettings,
    loading
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}; 