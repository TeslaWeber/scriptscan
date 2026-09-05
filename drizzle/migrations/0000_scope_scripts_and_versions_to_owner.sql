-- Make saved work private per staff account
ALTER TABLE public.scripts DROP CONSTRAINT IF EXISTS scripts_course_matric_key;
ALTER TABLE public.scripts ADD CONSTRAINT scripts_user_course_matric_key UNIQUE (user_id, course, matric);

DROP POLICY IF EXISTS "Staff view scripts" ON public.scripts;
DROP POLICY IF EXISTS "Staff update scripts" ON public.scripts;
DROP POLICY IF EXISTS "Staff delete scripts" ON public.scripts;
DROP POLICY IF EXISTS "Staff insert scripts" ON public.scripts;

CREATE POLICY "Owner view scripts" ON public.scripts FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND is_staff(auth.uid()));
CREATE POLICY "Owner insert scripts" ON public.scripts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND is_staff(auth.uid()));
CREATE POLICY "Owner update scripts" ON public.scripts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND is_staff(auth.uid()))
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner delete scripts" ON public.scripts FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND is_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff can view export versions" ON public.export_versions;
DROP POLICY IF EXISTS "Staff can delete export versions" ON public.export_versions;
DROP POLICY IF EXISTS "Staff can create export versions" ON public.export_versions;

CREATE POLICY "Owner view export versions" ON public.export_versions FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND is_staff(auth.uid()));
CREATE POLICY "Owner create export versions" ON public.export_versions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND is_staff(auth.uid()));
CREATE POLICY "Owner delete export versions" ON public.export_versions FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND is_staff(auth.uid()));