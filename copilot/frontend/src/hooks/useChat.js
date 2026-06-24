import { useState } from "react";
import { auth, dbConversations, dbSilver } from "../services/firebase";
import { addDoc, collection, serverTimestamp, getDoc, doc } from "firebase/firestore";
import { v4 as uuid } from "uuid";

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState(null);

  const sendMessage = async (input) => {
    if (!input.trim()) return;

    // 1️⃣ mensagem do utilizador
    setMessages((prev) => [
      ...prev,
      { id: uuid(), role: "user", content: input },
    ]);
    setIsTyping(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Sessão expirada. Faz login novamente.");

      if (!import.meta.env.VITE_API_URL)
        throw new Error("VITE_API_URL não configurado");

      const token = await user.getIdToken();
      const response = await fetch(`${import.meta.env.VITE_API_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt: input }),
      });

      if (!response.ok) throw new Error("Erro no servidor. Tente novamente.");

      const { answer } = await response.json();

      // 2️⃣ resposta da IA
      setMessages((prev) => [
        ...prev,
        { id: uuid(), role: "assistant", content: answer },
      ]);

      // 3️⃣ grava no Firestore (colecção "conversations")
      const userDoc = await getDoc(doc(dbSilver, "users", user.uid));
      const userData = userDoc.exists() ? userDoc.data() : {};

      await addDoc(collection(dbConversations, "conversations"), {
        uid: user.uid,
        question: input,
        answer,
        timestamp: serverTimestamp(),
        username: userData.username || "desconhecido",
      });
    } catch (err) {
      console.error(err);
      setError(err.message);
      setMessages((prev) => [
        ...prev,
        {
          id: uuid(),
          role: "assistant",
          content: err.message || "Ups! Algo correu mal. Tenta de novo.",
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  return { messages, sendMessage, isTyping, error, setMessages };
}
