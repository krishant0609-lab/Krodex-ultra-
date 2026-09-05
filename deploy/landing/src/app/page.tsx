export default function Home() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
      <div style={{ maxWidth: 760, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #5b8def, #9b5bef)', display: 'grid', placeItems: 'center', fontWeight: 700, color: '#fff' }}>K</div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: 0.2 }}>KRODEX</div>
          <div style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 999, background: '#16223a', border: '1px solid #233154', fontSize: 12, color: '#9fb0d4' }}>v1.0</div>
        </div>

        <h1 style={{ fontSize: 44, lineHeight: 1.15, margin: '0 0 16px', fontWeight: 700, letterSpacing: -0.5 }}>
          Study management,<br />engineered for evidence.
        </h1>
        <p style={{ fontSize: 18, lineHeight: 1.6, color: '#aebbd6', margin: '0 0 32px' }}>
          Server-validated syllabus. Verifiable error lifecycle. Privacy-first evidence.
          Production-ready, deployed on Vercel + Supabase.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 32 }}>
          <div style={{ padding: 18, borderRadius: 12, background: '#121a2e', border: '1px solid #1f2a47' }}>
            <div style={{ fontSize: 12, color: '#7a8aae', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 }}>Database</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>Supabase ✓</div>
            <div style={{ fontSize: 13, color: '#9fb0d4', marginTop: 6 }}>45 tables · 44 with RLS · 3 storage buckets</div>
          </div>
          <div style={{ padding: 18, borderRadius: 12, background: '#121a2e', border: '1px solid #1f2a47' }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#9fb0d4' }}>Frontend</div>
            <div style={{ fontSize: 13, color: '#7a8aae', marginTop: 6 }}>Status: landing page (this page) is live on Vercel</div>
          </div>
          <div style={{ padding: 18, borderRadius: 12, background: '#121a2e', border: '1px solid #1f2a47' }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#9fb0d4' }}>API + Worker</div>
            <div style={{ fontSize: 13, color: '#7a8aae', marginTop: 6 }}>Awaiting persistent host — see deployment status</div>
          </div>
        </div>

        <div style={{ padding: 20, borderRadius: 12, background: '#0e1626', border: '1px solid #1a2540', marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>What is live</div>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9, color: '#c2cce0', fontSize: 14 }}>
            <li>Database schema (20 migrations applied) — Supabase project <code style={{ color: '#9fb0d4' }}>krodex-production</code> (ap-northeast-1)</li>
            <li>Storage buckets (error-captures, question-snapshots, error-evidence) — created, private</li>
            <li>RPCs: submit_test_attempt, schedule_review_for_error, record_progress_evidence, mark_due_reviews, detect_missed_tasks, recompute_analytics_rollup, recompute_student_model</li>
            <li>Outbox + idempotency + audit log + 1194 unit tests preserved</li>
          </ul>
        </div>

        <div style={{ padding: 20, borderRadius: 12, background: '#0e1626', border: '1px solid #1a2540', marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Deployment status (2026-09-05)</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#c2cce0' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#7a8aae', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                <th style={{ padding: '4px 0', fontWeight: 500 }}>Tier</th>
                <th style={{ padding: '4px 0', fontWeight: 500 }}>Status</th>
                <th style={{ padding: '4px 0', fontWeight: 500 }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '6px 0', borderTop: '1px solid #1f2a47' }}>Database</td>
                <td style={{ padding: '6px 0', borderTop: '1px solid #1f2a47', color: '#7adf9c' }}>LIVE</td>
                <td style={{ padding: '6px 0', borderTop: '1px solid #1f2a47' }}>Supabase: gikanzcuyblrffybcrsa · 20 migrations · RLS on</td>
              </tr>
              <tr>
                <td style={{ padding: '6px 0', borderTop: '1px solid #1f2a47' }}>Landing</td>
                <td style={{ padding: '6px 0', borderTop: '1px solid #1f2a47', color: '#7adf9c' }}>LIVE</td>
                <td style={{ padding: '6px 0', borderTop: '1px solid #1f2a47' }}>Vercel: krodex-landing · this page (SSO disabled)</td>
              </tr>
              <tr>
                <td style={{ padding: '6px 0', borderTop: '1px solid #1f2a47' }}>apps/web</td>
                <td style={{ padding: '6px 0', borderTop: '1px solid #1f2a47', color: '#df9c7a' }}>BLOCKED</td>
                <td style={{ padding: '6px 0', borderTop: '1px solid #1f2a47' }}>Requires NEXT_PUBLIC_API_BASE_URL pointing to a live API; no API host available</td>
              </tr>
              <tr>
                <td style={{ padding: '6px 0', borderTop: '1px solid #1f2a47' }}>apps/api</td>
                <td style={{ padding: '6px 0', borderTop: '1px solid #1f2a47', color: '#df9c7a' }}>BLOCKED</td>
                <td style={{ padding: '6px 0', borderTop: '1px solid #1f2a47' }}>No Railway MCP / CLI auth / browser in this session; needs RAILWAY_TOKEN + provisioning</td>
              </tr>
              <tr>
                <td style={{ padding: '6px 0', borderTop: '1px solid #1f2a47' }}>Worker / scheduler</td>
                <td style={{ padding: '6px 0', borderTop: '1px solid #1f2a47', color: '#df9c7a' }}>BLOCKED</td>
                <td style={{ padding: '6px 0', borderTop: '1px solid #1f2a47' }}>Lives in apps/api (outbox 5s, mark_review_due 5m, detect_task_missed 15m, recompute 5m, student_model 5m)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ padding: 20, borderRadius: 12, background: '#0e1626', border: '1px solid #1a2540' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Unblock steps (human owner action)</div>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9, color: '#c2cce0', fontSize: 14 }}>
            <li>Provide <code style={{ color: '#9fb0d4' }}>RAILWAY_TOKEN</code> (or run <code style={{ color: '#9fb0d4' }}>railway login</code> in a terminal) so the API can be provisioned.</li>
            <li>Provision a Railway service from <code style={{ color: '#9fb0d4' }}>apps/api</code> with: NODE_ENV=production, PORT=8080, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, CORS_ALLOWED_ORIGINS (vercel URL), WEB_ORIGIN (vercel URL), LOG_LEVEL=info.</li>
            <li>Once the Railway URL is known, set <code style={{ color: '#9fb0d4' }}>NEXT_PUBLIC_API_BASE_URL</code> on Vercel for the krodex-landing project (or a new <code style={{ color: '#9fb0d4' }}>krodex-web</code> project) and deploy <code style={{ color: '#9fb0d4' }}>apps/web</code>.</li>
            <li>Verify chain: web → api → supabase with real auth, then run a full test attempt loop end-to-end.</li>
          </ol>
        </div>

        <div style={{ marginTop: 28, fontSize: 12, color: '#5d6c8c' }}>
          KRODEX v1.0 — production source: <code style={{ color: '#9fb0d4' }}>v1.0-verified</code> tag · branch <code style={{ color: '#9fb0d4' }}>deployment/v1.0-production</code> · SSO disabled (public access)
        </div>
      </div>
    </main>
  );
}
