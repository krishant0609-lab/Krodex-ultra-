-- =============================================================
-- KRODEX — migration 05: minimal dev seed
-- Phase 1
-- =============================================================
--
-- Idempotent. Safe to apply multiple times. Only seeds global
-- content (subjects, topics, capture sources). Does NOT seed
-- any user row — those land via auth signup or a Phase 2
-- admin path.

set search_path = public, extensions;

-- Capture sources (global) ----------------------------------------
insert into public.capture_sources (code, display_name) values
  ('manual',             'Manual entry'),
  ('clipboard_text',     'Clipboard text'),
  ('browser_extension',  'Browser extension v1')
on conflict (code) do update set display_name = excluded.display_name;

-- Subjects (global) -----------------------------------------------
insert into public.subjects (code, name, display_order) values
  ('MATH',  'Mathematics', 10),
  ('PHYS',  'Physics',     20),
  ('CHEM',  'Chemistry',   30),
  ('BIO',   'Biology',     40),
  ('ENGL',  'English',     50)
on conflict (code) do update
  set name = excluded.name,
      display_order = excluded.display_order,
      is_active = true;

-- One demo topic per subject so the FK chain is satisfied ---------
insert into public.topics (subject_id, code, name, display_order)
select s.id, t.code, t.name, t.display_order
from public.subjects s
join (values
  ('MATH', 'ALGEBRA',  'Algebra',     10),
  ('MATH', 'CALCULUS', 'Calculus',    20),
  ('PHYS', 'MECH',     'Mechanics',   10),
  ('PHYS', 'OPTICS',   'Optics',      20),
  ('CHEM', 'ORG',      'Organic',     10),
  ('BIO',  'CELL',     'Cell Biology',10)
) as t(subject_code, code, name, display_order)
on s.code = t.subject_code
on conflict (subject_id, code) do update
  set name = excluded.name,
      display_order = excluded.display_order;
