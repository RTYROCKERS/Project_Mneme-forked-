import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserCircle, Sparkles, Send, Save, Bot, User as UserIcon } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import api, { getErrorMessage } from '@/lib/api';

const GREETING = {
  role: 'assistant',
  content:
    "Hi! I'm your learning coach. Tell me a bit about yourself — what you're trying to learn, your goals, and how you like to learn. I'll help shape your learner profile so the material we generate fits you.",
};

export default function Profile() {
  const qc = useQueryClient();

  // ── Saved profile ────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get('/profile').then((r) => r.data),
  });

  const [description, setDescription] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data?.profile_description !== undefined) setDescription(data.profile_description || '');
  }, [data?.profile_description]);

  const saveProfile = useMutation({
    mutationFn: (payload) => api.put('/profile', payload).then((r) => r.data),
    onMutate: () => { setSaveError(''); setSaved(false); },
    onSuccess: (res) => {
      qc.setQueryData(['profile'], res);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err) => setSaveError(getErrorMessage(err)),
  });

  // ── Chatbot ──────────────────────────────────────────────────
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [chatError, setChatError] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const chat = useMutation({
    mutationFn: (history) =>
      api.post('/profile/chat', { messages: history }).then((r) => r.data),
    onError: (err) => setChatError(getErrorMessage(err)),
  });

  const synthesize = useMutation({
    mutationFn: (history) =>
      api.post('/profile/synthesize', { messages: history }).then((r) => r.data),
    onSuccess: (res) => setDescription(res.profile_description || ''),
    onError: (err) => setChatError(getErrorMessage(err)),
  });

  const sendMessage = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || chat.isPending) return;
    setChatError('');

    const history = [...messages, { role: 'user', content: text }];
    setMessages(history);
    setInput('');

    try {
      const { reply } = await chat.mutateAsync(history);
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
    } catch {
      // error already surfaced via chatError; restore the user's text
      setInput(text);
      setMessages(messages);
    }
  };

  const handleGenerate = () => {
    setChatError('');
    synthesize.mutate(messages);
  };

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-dim)]">
          <UserCircle size={20} className="text-[var(--accent)]" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Your learner profile</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            This profile is sent with every request so generated material matches your point of view, ability and goals.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Profile description editor */}
        <Card>
          <CardHeader>
            <CardTitle>Profile description</CardTitle>
            <CardDescription>Edit directly, or build it with the coach on the right.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="flex justify-center py-10"><Spinner size="lg" /></div>
            ) : (
              <>
                <Textarea
                  className="min-h-[200px]"
                  placeholder="e.g. I'm a final-year CS student preparing for product-based interviews. I learn best with concrete examples and analogies, and I struggle with abstract math-heavy explanations…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                {saveError && (
                  <p className="rounded-lg bg-[rgba(229,107,111,0.1)] border border-[rgba(229,107,111,0.3)] px-3 py-2 text-sm text-[var(--danger)]">
                    {saveError}
                  </p>
                )}
                <div className="flex items-center gap-3">
                  <Button onClick={() => saveProfile.mutate({ profile_description: description })} disabled={saveProfile.isPending}>
                    <Save size={14} /> {saveProfile.isPending ? 'Saving…' : 'Save profile'}
                  </Button>
                  {saved && <span className="text-sm text-[var(--success)]">Saved</span>}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Coach chatbot */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Talk to your coach</CardTitle>
            <CardDescription>Chat, then generate a profile description from the conversation.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3">
            <div ref={scrollRef} className="flex-1 max-h-80 min-h-60 overflow-y-auto space-y-3 pr-1">
              {messages.map((m, i) => (
                <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-dim)] text-[var(--accent)]">
                    {m.role === 'user' ? <UserIcon size={14} /> : <Bot size={14} />}
                  </div>
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {chat.isPending && (
                <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <Spinner size="sm" /> Coach is typing…
                </div>
              )}
            </div>

            {chatError && (
              <p className="rounded-lg bg-[rgba(229,107,111,0.1)] border border-[rgba(229,107,111,0.3)] px-3 py-2 text-sm text-[var(--danger)]">
                {chatError}
              </p>
            )}

            <form onSubmit={sendMessage} className="flex items-end gap-2">
              <Textarea
                className="min-h-[44px]"
                placeholder="Type your message…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) sendMessage(e);
                }}
              />
              <Button type="submit" size="icon" disabled={chat.isPending || !input.trim()}>
                <Send size={15} />
              </Button>
            </form>

            <Button variant="subtle" onClick={handleGenerate} disabled={synthesize.isPending || messages.length < 2}>
              <Sparkles size={14} />
              {synthesize.isPending ? 'Generating…' : 'Generate profile from chat'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
