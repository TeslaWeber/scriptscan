CREATE TABLE public.export_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course text NOT NULL,
  version integer NOT NULL,
  filename text NOT NULL,
  record_count integer NOT NULL DEFAULT 0,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX export_versions_course_idx ON public.export_versions (course, version DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.export_versions TO authenticated;
GRANT ALL ON public.export_versions TO service_role;

ALTER TABLE public.export_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view export versions"
  ON public.export_versions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'staff') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Staff can create export versions"
  ON public.export_versions FOR INSERT TO authenticated
  WITH CHECK ((public.has_role(auth.uid(),'staff') OR public.has_role(auth.uid(),'admin')) AND auth.uid() = user_id);

CREATE POLICY "Staff can delete export versions"
  ON public.export_versions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'staff') OR public.has_role(auth.uid(),'admin'));

-- Backfill: make sure every existing account has staff access
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'staff'::public.app_role FROM auth.users u
ON CONFLICT (user_id, role) DO NOTHING;