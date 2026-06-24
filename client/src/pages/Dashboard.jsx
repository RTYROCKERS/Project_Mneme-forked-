import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BookOpen, Brain, Lightbulb, TrendingUp, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useAuthStore } from '@/store/authStore';
import api from '@/lib/api';

function StatCard({ icon: Icon, label, value, color = 'var(--accent)' }) {
  return (
    <Card>
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}22` }}>
          <Icon size={18} style={{ color }} />
        </div>
        <div>
          <p className="text-2xl font-semibold text-[var(--text-primary)]">{value}</p>
          <p className="text-xs text-[var(--text-muted)]">{label}</p>
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuthStore();

  const { data: topics = [], isLoading: loadingTopics } = useQuery({
    queryKey: ['topics'],
    queryFn: () => api.get('/topics').then((r) => r.data),
  });

  const { data: recommendations = [], isLoading: loadingReco } = useQuery({
    queryKey: ['recommendations'],
    queryFn: () => api.get(`/recommendations/${user.id}`).then((r) => r.data),
    enabled: !!user,
  });

  const { data: mastery = [] } = useQuery({
    queryKey: ['mastery'],
    queryFn: () => api.get(`/mastery/${user.id}`).then((r) => r.data),
    enabled: !!user,
  });

  const avgMastery = mastery.length
    ? mastery.reduce((sum, m) => sum + m.mastery_score, 0) / mastery.length
    : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          Good day, {user?.name?.split(' ')[0]} 👋
        </h1>
        <p className="text-sm text-[var(--text-muted)] mt-0.5">Here's your learning snapshot</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={BookOpen}   label="Topics"          value={topics.length}  color="var(--accent)" />
        <StatCard icon={Brain}      label="Concepts"        value={mastery.length} color="var(--success)" />
        <StatCard icon={Lightbulb}  label="Avg Mastery"     value={`${Math.round(avgMastery * 100)}%`} color="var(--warning)" />
        <StatCard icon={TrendingUp} label="Recommended"     value={recommendations.length} color="var(--accent-hover)" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Recommendations */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Top recommendations</CardTitle>
              <Link to="/study">
                <Button variant="ghost" size="sm">
                  Study <ArrowRight size={14} />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {loadingReco ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : recommendations.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-4 text-center">
                Add a topic and generate concepts to get recommendations
              </p>
            ) : (
              <ul className="space-y-3">
                {recommendations.map((r) => (
                  <li key={r.concept_id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{r.concept_name}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">{r.reason}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-[var(--accent)]">{Math.round(r.priority_score * 100)}</p>
                      <p className="text-xs text-[var(--text-muted)]">score</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent Topics */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent topics</CardTitle>
              <Link to="/topics">
                <Button variant="ghost" size="sm">
                  All <ArrowRight size={14} />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {loadingTopics ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : topics.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-4 text-center">No topics yet</p>
            ) : (
              <ul className="space-y-3">
                {topics.slice(0, 5).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{t.name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{t.concept_count} concepts</p>
                    </div>
                    <Badge variant={t.depth_level}>{t.depth_level}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mastery overview */}
      {mastery.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Mastery overview</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {mastery.slice(0, 8).map((m) => (
                <li key={m.id} className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-[var(--text-primary)] truncate">{m.concept_name}</span>
                      <span className="text-xs text-[var(--text-muted)] shrink-0 ml-2">
                        {Math.round(m.mastery_score * 100)}%
                      </span>
                    </div>
                    <Progress value={m.mastery_score} />
                  </div>
                  <Badge variant={m.difficulty_level} className="shrink-0">{m.difficulty_level}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
