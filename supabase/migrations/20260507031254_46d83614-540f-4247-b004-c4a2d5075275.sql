
ALTER TABLE public.scripts ALTER COLUMN matric DROP NOT NULL;
ALTER TABLE public.scripts ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE public.scripts ADD COLUMN IF NOT EXISTS error text;
