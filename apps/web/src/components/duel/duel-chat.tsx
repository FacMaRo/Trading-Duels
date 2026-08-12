'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { getDuelsSocket } from '@/lib/socket';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ChatMessage {
  duelId: string;
  userId: string;
  username: string;
  message: string;
  ts: number;
}

interface DuelChatProps {
  duelId: string;
  myUserId: string;
}

export function DuelChat({ duelId, myUserId }: DuelChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = getDuelsSocket();
    const onMsg = (msg: ChatMessage) => {
      if (msg.duelId !== duelId) return;
      setMessages((prev) => [...prev.slice(-80), msg]);
    };
    socket.on('duel:chat_message', onMsg);
    return () => {
      socket.off('duel:chat_message', onMsg);
    };
  }, [duelId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function send(e: FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    const socket = getDuelsSocket();
    socket.emit('duel:chat', { duelId, message });
    setText('');
  }

  return (
    <div className="flex h-full min-h-[140px] flex-col rounded-xl border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Match chat
        </h3>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto px-3 py-2">
        {messages.length === 0 && (
          <p className="py-4 text-center text-[11px] text-muted-foreground/70">
            No messages. Stay focused.
          </p>
        )}
        {messages.map((m, i) => {
          const mine = m.userId === myUserId;
          return (
            <div
              key={`${m.ts}-${i}`}
              className={cn('text-xs', mine ? 'text-right' : 'text-left')}
            >
              <span className="font-semibold text-muted-foreground">
                {mine ? 'You' : m.username}
              </span>
              <p
                className={cn(
                  'mt-0.5 inline-block max-w-[90%] rounded-lg px-2 py-1',
                  mine
                    ? 'bg-primary/15 text-foreground'
                    : 'bg-secondary text-foreground',
                )}
              >
                {m.message}
              </p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={send}
        className="flex gap-1.5 border-t border-border p-2"
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message…"
          maxLength={280}
          className="h-8 text-xs"
        />
        <Button type="submit" size="icon" className="h-8 w-8 shrink-0">
          <Send className="h-3.5 w-3.5" />
        </Button>
      </form>
    </div>
  );
}
