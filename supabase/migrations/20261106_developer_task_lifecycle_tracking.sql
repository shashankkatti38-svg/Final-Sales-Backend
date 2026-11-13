-- Migration: 20261106_developer_task_lifecycle_tracking.sql
-- Step 3: Developer Task Execution & Progress Management

-- 1. Expand tasks status constraint
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('Pending', 'Not Started', 'In Progress', 'On Hold', 'Blocked', 'Submitted for Review', 'Completed', 'Overdue'));

-- 2. Expand task_assignments status constraint
ALTER TABLE public.task_assignments DROP CONSTRAINT IF EXISTS task_assignment_status_check;
ALTER TABLE public.task_assignments ADD CONSTRAINT task_assignment_status_check
  CHECK (status IN ('Pending', 'Not Started', 'In Progress', 'On Hold', 'Blocked', 'Submitted for Review', 'Completed', 'Overdue'));

-- 3. Add progress and execution tracking columns to tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS progress_percentage INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_notes TEXT,
  ADD COLUMN IF NOT EXISTS blocker_reason TEXT,
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submission_notes TEXT,
  ADD COLUMN IF NOT EXISTS deliverables JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS history JSONB DEFAULT '[]'::jsonb;

