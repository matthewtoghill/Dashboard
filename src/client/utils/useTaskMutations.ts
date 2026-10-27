import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createTask,
  updateTask,
  deleteTask,
  archiveTasks,
  restoreTasks,
  deleteTasks,
  reorderTasks,
  createSubtask,
  updateSubtask,
  deleteSubtask,
} from '../api.ts';
import { Project, Task, TaskStatus, UpdateSubtaskInput, UpdateTaskInput } from '../../shared/types.ts';
import { nextOccurrence } from '../../shared/recurrence.ts';
import { ConfirmRequest } from '../components/Feedback.tsx';
import { DeferredHandle, UNDO_HINT } from './useDeferredDelete.ts';
import {
  formatDayDate,
  getTodayIso,
  parseQuickAddSyntax,
  plural,
  sortOrderForMove,
  errorMessage,
} from './taskUtils.ts';

interface TaskMutationOptions {
  /** Tasks and projects as shown, i.e. without items awaiting a deferred delete. */
  tasks: Task[];
  projects: Project[];
  showToast: (message: string, undo?: (() => void) | DeferredHandle) => void;
  confirm: (request: ConfirmRequest) => void;
  schedule: (ids: string[], commit: () => Promise<void>) => DeferredHandle;
  /** Called when a task leaves the list (deleted or archived), e.g. to close its drawer. */
  onTaskRemoved: (id: string) => void;
}

/** Task and subtask mutations, plus the handlers that add confirmation, undo and toasts to them. */
export function useTaskMutations({
  tasks,
  projects,
  showToast,
  confirm,
  schedule,
  onTaskRemoved,
}: TaskMutationOptions) {
  const queryClient = useQueryClient();
  const invalidateTasks = () => queryClient.invalidateQueries({ queryKey: ['tasks'] });

  const createTaskMutation = useMutation({
    mutationFn: createTask,
    onSuccess: () => invalidateTasks(),
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateTaskInput }) =>
      updateTask(id, payload),
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previous = queryClient.getQueryData<Task[]>(['tasks']);
      if (previous) {
        queryClient.setQueryData<Task[]>(
          ['tasks'],
          previous.map((t) => (t.id === id ? { ...t, ...payload } : t))
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['tasks'], context.previous);
      }
    },
    onSuccess: (result) => {
      if (result.keptOccurrenceId) {
        showToast('Its next occurrence was already edited, so it was kept');
      }
    },
    onSettled: () => invalidateTasks(),
  });

  const createSubtaskMutation = useMutation({
    mutationFn: ({ taskId, title }: { taskId: string; title: string }) =>
      createSubtask(taskId, { title }),
    onSuccess: () => invalidateTasks(),
  });

  const updateSubtaskMutation = useMutation({
    mutationFn: ({ subtaskId, ...input }: { subtaskId: string } & UpdateSubtaskInput) =>
      updateSubtask(subtaskId, input),
    onSuccess: () => invalidateTasks(),
  });

  /** Creates a task from quick-add text; typed tokens win over the given project and due date. */
  const createTaskFromText = (text: string, projectId: string | null, dueDate: string | null) => {
    const parsed = parseQuickAddSyntax(text, projects, { priority: 0, projectId, dueDate, tags: [] });
    createTaskMutation.mutate({
      title: parsed.title,
      priority: parsed.priority,
      projectId: parsed.projectId,
      dueDate: parsed.dueDate,
      tags: parsed.tags,
      recurrence: parsed.recurrence,
    });
  };

  const handleUpdateTask = (id: string, payload: UpdateTaskInput) => {
    updateTaskMutation.mutate({ id, payload });
  };

  const handleRescheduleTask = (task: Task, dueDate: string) => {
    const previous = task.dueDate;
    updateTaskMutation.mutate({ id: task.id, payload: { dueDate } });
    showToast(`Moved "${task.title}" to ${formatDayDate(dueDate)}`, () =>
      updateTaskMutation.mutate({ id: task.id, payload: { dueDate: previous } })
    );
  };

  /** Cycles status on checkbox click: To Do → In Progress → Completed → To Do. On Hold resumes as In Progress. */
  const handleToggleTask = (task: Task) => {
    if (task.status === 'done') {
      updateTaskMutation.mutate({ id: task.id, payload: { status: 'todo' } });
      return;
    }
    if (task.status === 'todo' || task.status === 'on_hold') {
      updateTaskMutation.mutate({ id: task.id, payload: { status: 'in_progress' } });
      return;
    }
    completeTask(task);
  };

  /** Sets a status directly (context menu); completing shows the same toast and undo as the checkbox. */
  const handleSetStatus = (task: Task, status: TaskStatus) => {
    if (status === task.status) return;
    if (status === 'done') completeTask(task);
    else updateTaskMutation.mutate({ id: task.id, payload: { status } });
  };

  const completeTask = (task: Task) => {
    const previous = task.status === 'in_progress' || task.status === 'on_hold' ? task.status : 'todo';
    updateTaskMutation.mutate({ id: task.id, payload: { status: 'done' } });
    const nextDue = task.recurrence
      ? ` · next due ${formatDayDate(nextOccurrence(task.recurrence, task.dueDate, getTodayIso()))}`
      : '';
    // Undo reopens the task; the server then also withdraws the untouched next occurrence
    showToast(`Completed "${task.title}"${nextDue}`, () =>
      updateTaskMutation.mutate({ id: task.id, payload: { status: previous } })
    );
  };

  /** Manual sort: give the moved task a sortOrder between its new neighbours. */
  const handleMoveTask = (list: Task[], taskId: string, targetIndex: number) => {
    const moved = list.find((t) => t.id === taskId);
    if (!moved) return;
    const others = list.filter((t) => t.id !== taskId);
    const order = sortOrderForMove(
      others.map((t) => t.sortOrder),
      targetIndex
    );
    if (order !== null) {
      updateTaskMutation.mutate({ id: taskId, payload: { sortOrder: order } });
      return;
    }
    // No gap between the neighbours (e.g. imported tasks sharing an order): respace this list
    // on the server in one transaction.
    const reordered = [...others.slice(0, targetIndex), moved, ...others.slice(targetIndex)];
    reorderTasks(reordered.map((t) => t.id)).then(
      () => invalidateTasks(),
      (err) => showToast(errorMessage(err, 'Reorder failed'))
    );
  };

  const handleDeleteTask = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const subtaskNote = task.subtasks.length
      ? ` and its ${plural(task.subtasks.length, 'subtask')}`
      : '';
    confirm({
      title: 'Delete task?',
      message: `"${task.title}"${subtaskNote} will be permanently deleted.\n${UNDO_HINT}`,
      confirmLabel: 'Delete task',
      onConfirm: () => {
        onTaskRemoved(id);
        const undo = schedule([id], async () => {
          await deleteTask(id);
          await invalidateTasks();
        });
        showToast(`Deleted "${task.title}"`, undo);
      },
    });
  };

  const handleDeleteSubtask = (subtaskId: string) => {
    // Subtasks are low-stakes: undo only, no confirmation step.
    const undo = schedule([subtaskId], async () => {
      await deleteSubtask(subtaskId);
      await invalidateTasks();
    });
    showToast('Subtask deleted', undo);
  };

  const runRestore = async (ids: string[]) => {
    await restoreTasks(ids);
    await invalidateTasks();
  };

  const runArchive = async (ids: string[], message: string) => {
    try {
      await archiveTasks(ids);
      await invalidateTasks();
      showToast(message, () => void runRestore(ids));
    } catch (err) {
      showToast(errorMessage(err, 'Archive failed'));
    }
  };

  const handleArchiveTask = (task: Task) => {
    onTaskRemoved(task.id);
    void runArchive([task.id], `Archived "${task.title}"`);
  };

  const handleRestoreTasks = (list: Task[]) => {
    runRestore(list.map((t) => t.id)).then(
      () =>
        showToast(
          list.length === 1 ? `Restored "${list[0].title}"` : `Restored ${plural(list.length, 'task')}`
        ),
      (err) => showToast(errorMessage(err, 'Restore failed'))
    );
  };

  /** Archives the given completed tasks after a confirmation that names the scope. */
  const requestArchiveCompleted = (completed: Task[], scope: string) => {
    if (completed.length === 0) {
      showToast('There are no completed tasks to archive');
      return;
    }
    const count = plural(completed.length, 'completed task');
    confirm({
      title: 'Archive completed tasks?',
      message:
        `${count} ${scope} will be moved to the Archive.\n` +
        'They are hidden from other views but not deleted: you can restore them, ' +
        'or delete them permanently, from Archive.',
      confirmLabel: `Archive ${completed.length}`,
      onConfirm: () =>
        void runArchive(
          completed.map((t) => t.id),
          `Archived ${count}`
        ),
    });
  };

  const requestDeleteArchived = (archived: Task[], scope = 'shown in this view') => {
    const count = plural(archived.length, 'archived task');
    confirm({
      title: 'Permanently delete archived tasks?',
      message:
        `${count} ${scope} (and their subtasks) will be permanently deleted.\n` +
        UNDO_HINT,
      confirmLabel: `Delete ${archived.length}`,
      onConfirm: () => {
        const ids = archived.map((t) => t.id);
        const undo = schedule(ids, async () => {
          await deleteTasks(ids);
          await invalidateTasks();
        });
        showToast(`Deleted ${count}`, undo);
      },
    });
  };

  return {
    createTaskMutation,
    createTaskFromText,
    handleCreateSubtask: (taskId: string, title: string) =>
      createSubtaskMutation.mutate({ taskId, title }),
    handleUpdateSubtask: (subtaskId: string, input: UpdateSubtaskInput) =>
      updateSubtaskMutation.mutate({ subtaskId, ...input }),
    handleDeleteSubtask,
    handleUpdateTask,
    handleRescheduleTask,
    handleToggleTask,
    handleSetStatus,
    handleMoveTask,
    handleDeleteTask,
    handleArchiveTask,
    handleRestoreTasks,
    requestArchiveCompleted,
    requestDeleteArchived,
  };
}
