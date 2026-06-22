import { useQuery } from '@tanstack/react-query';
import { RadialBarChart, RadialBar, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { Spinner } from '@/components/ui/Spinner';
import { useAuthStore } from '@/store/authStore';
import api from '@/lib/api';

const COLORS = { easy: '#4caf8c', intermediate: '#e5a456', hard: '#e56b6f' };

export default function Stats() {
  const { user } = useAuthStore();

  const { data: mastery = [], isLoading } = useQuery({
    queryKey: ['mastery'],
    queryFn: () => api.get(`/mastery/${user.id}`).then((r) => r.data),
    enabled: !!user,
  });

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size="lg" /></div>;

  const avgMastery = mastery.length
    ? mastery.reduce((s, m) => s + m.mastery_score, 0) / mastery.length
    : 0;

  const byDifficulty = ['easy', 'intermediate', 'hard'].map((d) => {
    const items = mastery.filter((m) => m.difficulty_level === d);
    return {
      name: d,
      count: items.length,
      avg: items.length ? items.reduce((s, m) => s + m.mastery_score, 0) / items.length : 0,
    };
  });

  const chartData = mastery
    .slice(0, 10)
    .map((m) => ({ name: m.concept_name?.slice(0, 16), mastery: Math.round(m.mastery_score * 100) }));

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Progress</h1>
        <p className="text-sm text-[var(--text-muted)] mt-0.5">{mastery.length} concepts tracked</p>
      </div>

      {mastery.length === 0 ? (
        <Card className="flex flex-col items-center py-14 gap-3">
          <p className="text-sm text-[var(--text-muted)]">No data yet. Start studying to see progress.</p>
        </Card>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            {byDifficulty.map((d) => (
              <Card key={d.name}>
                <div className="flex items-center justify-between mb-2">
                  <Badge variant={d.name}>{d.name}</Badge>
                  <span className="text-lg font-semibold text-[var(--text-primary)]">{d.count}</span>
                </div>
                <Progress value={d.avg} />
                <p className="text-xs text-[var(--text-muted)] mt-1">{Math.round(d.avg * 100)}% avg mastery</p>
              </Card>
            ))}
          </div>

          {/* Bar chart */}
          <Card>
            <CardHeader>
              <CardTitle>Top concepts mastery</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#8b9cb5' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#8b9cb5' }} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{ background: '#1e2536', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', fontSize: '12px' }}
                    labelStyle={{ color: '#e8eaf0' }}
                    itemStyle={{ color: '#6c8cff' }}
                  />
                  <Bar dataKey="mastery" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell key={index} fill={entry.mastery >= 70 ? '#4caf8c' : entry.mastery >= 40 ? '#e5a456' : '#e56b6f'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Full list */}
          <Card>
            <CardHeader>
              <CardTitle>All concepts</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {mastery
                  .sort((a, b) => b.mastery_score - a.mastery_score)
                  .map((m) => (
                    <li key={m.id} className="flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm text-[var(--text-primary)] truncate">{m.concept_name}</span>
                            <Badge variant={m.difficulty_level}>{m.difficulty_level}</Badge>
                          </div>
                          <span className="text-xs text-[var(--text-muted)] shrink-0 ml-2">
                            {Math.round(m.mastery_score * 100)}%
                          </span>
                        </div>
                        <Progress value={m.mastery_score} />
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          {m.revision_count} revisions · {Math.round((m.time_spent_seconds || 0) / 60)}m studied
                          {m.days_since_review !== undefined && ` · ${m.days_since_review}d since review`}
                        </p>
                      </div>
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
