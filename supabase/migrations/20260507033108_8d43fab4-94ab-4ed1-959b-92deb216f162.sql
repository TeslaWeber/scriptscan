DROP INDEX IF EXISTS public.scripts_course_matric_uidx;
ALTER TABLE public.scripts ADD CONSTRAINT scripts_course_matric_key UNIQUE (course, matric);