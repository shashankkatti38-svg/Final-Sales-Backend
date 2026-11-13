-- Add assigned_role column to task_assignments if not exists
ALTER TABLE public.task_assignments ADD COLUMN IF NOT EXISTS assigned_role TEXT DEFAULT 'Developer';

