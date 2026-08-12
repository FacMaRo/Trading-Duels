'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MessageCircle, Send, Volume2, VolumeX } from 'lucide-react';
import { ensureBrSocketConnected } from '@/lib/socket';
import { brApi, type BrChatMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { PremiumBadge } from '@/components/ui/premium-badge';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/copy';

interface BrMatchChatProps {
  matchId: string;
  isPremium: boolean;
  className?: string;
}

export function BrMatchChat({
  matchId,
  isPremium,
  className,
}: BrMatchChatProps) {
  const [messages, setMessages] = useState<BrChatMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const storageKey = `br-chat-muted-${matchId}`;

  useEffect(() => {
    try {
      setMuted(localStorage.getItem(storageKey) === '1');
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, muted ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [muted, storageKey]);

  // Load history + live
  useEffect(() => {
    let cancelled = false;
    brApi
      .chatHistory(matchId)
      .then((msgs) => {
        if (!cancelled) setMessages(msgs);
      })
      .catch(() => {});

    const socket = ensureBrSocketConnected();
    socket.emit('br:chat_history', { matchId });

    const onMsg = (msg: BrChatMessage) => {
      if (msg.matchId !== matchId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg].slice(-100);
      });
    };
    const onHistory = (p: { matchId: string; messages: BrChatMessage[] }) => {
      if (p.matchId !== matchId) return;
      setMessages(p.messages ?? []);
    };
    const onErr = (p: { message: string }) => {
      if (p?.message) setError(p.message);
    };

    socket.on('br:chat', onMsg);
    socket.on('br:chat_history', onHistory);
    socket.on('br:error', onErr);

    return () => {
      cancelled = true;
      socket.off('br:chat', onMsg);
      socket.off('br:chat_history', onHistory);
      socket.off('br:error', onErr);
    };
  }, [matchId]);

  useEffect(() => {
    if (!muted && !collapsed) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, muted, collapsed]);

  const send = useCallback(async () => {
    setError('');
    const body = text.trim();
    if (!body) return;
    if (!isPremium) {
      setError(COPY.chat.premiumRequired);
      return;
    }
    setSending(true);
    try {
      // HTTP + WS dual: HTTP guarantees persistence
      await brApi.postChat(matchId, body);
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : COPY.chat.sendError);
    } finally {
      setSending(false);
    }
  }, [text, isPremium, matchId]);

  if (muted) {
    return (
      <div
        className={cn(
          'flex items-center justify-between rounded-md border border-border bg-card px-3 py-2',
          className,
        )}
      >
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <VolumeX className="h-3.5 w-3.5" />
          {COPY.chat.muted}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => setMuted(false)}
        >
          {COPY.chat.show}
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col rounded-md border border-border bg-card',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setCollapsed((c) => !c)}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {COPY.chat.title}
          {!isPremium && (
            <span className="text-[10px] text-muted-foreground/80">
              · {COPY.chat.readOnly}
            </span>
          )}
        </button>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            title={COPY.chat.mute}
            onClick={() => setMuted(true)}
          >
            <Volume2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="max-h-40 min-h-[100px] flex-1 space-y-1.5 overflow-y-auto px-3 py-2">
            {messages.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-muted-foreground">
                {COPY.chat.empty}
              </p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="text-[11px] leading-snug">
                  <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                    @{m.username}
                    {m.isPremium && (
                      <PremiumBadge size="sm" showLabel={false} />
                    )}
                  </span>
                  <span className="text-muted-foreground">: </span>
                  <span className="text-foreground/90">{m.body}</span>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-border p-2">
            {error && (
              <p className="mb-1.5 text-[10px] text-destructive">{error}</p>
            )}
            {isPremium ? (
              <div className="flex gap-1.5">
                <input
                  type="text"
                  maxLength={280}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={COPY.chat.placeholder}
                  className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <Button
                  size="sm"
                  className="h-8 px-2"
                  disabled={sending || !text.trim()}
                  onClick={() => void send()}
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5 rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-2 text-center">
                <p className="text-[10px] text-muted-foreground">
                  {COPY.chat.premiumOnly}
                </p>
                <Link
                  href="/stats"
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-200/90 hover:underline"
                >
                  {COPY.chat.seePremium}
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
