import { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import { useCreatePayment, useCreateSettlement, getGetDashboardQueryKey, getListPaymentsQueryKey, getListMembersQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export type OfflineTaskType = 'PAYMENT' | 'SETTLEMENT';

export interface OfflineTask {
  id: string; // idempotencyKey
  type: OfflineTaskType;
  payload: any;
  timestamp: number;
  status: 'PENDING' | 'FAILED';
  error?: string;
  metadata?: any;
}

interface SyncContextType {
  isOnline: boolean;
  queue: OfflineTask[];
  addToQueue: (task: Omit<OfflineTask, 'id' | 'timestamp' | 'status'> & { id?: string }) => void;
  removeFromQueue: (id: string) => void;
  syncQueue: () => Promise<void>;
  isSyncing: boolean;
  clearQueue: () => void;
  pendingCount: number;
}

const SyncContext = createContext<SyncContextType | null>(null);

const STORAGE_KEY = 'islamiya_offline_queue';

export function SyncProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState<OfflineTask[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const createPayment = useCreatePayment();
  const createSettlement = useCreateSettlement();
  const queryClient = useQueryClient();

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setQueue(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse offline queue", e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  }, [queue]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success("ইন্টারনেট সংযোগ ফিরে এসেছে (Online)");
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast.error("আপনি অফলাইনে আছেন (Offline Mode)");
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const addToQueue = useCallback((task: Omit<OfflineTask, 'id' | 'timestamp' | 'status'> & { id?: string }) => {
    const id = task.id || crypto.randomUUID();
    const newTask: OfflineTask = {
      ...task,
      id,
      timestamp: Date.now(),
      status: 'PENDING',
    };
    setQueue(q => {
        if (q.some(t => t.id === id)) return q; // duplicate check
        return [...q, newTask];
    });
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setQueue(q => q.filter(t => t.id !== id));
  }, []);

  const updateTaskError = useCallback((id: string, error: string) => {
    setQueue(q => q.map(t => t.id === id ? { ...t, status: 'FAILED', error } : t));
  }, []);

  const syncQueue = useCallback(async () => {
    if (!navigator.onLine || queue.length === 0 || isSyncing) return;
    setIsSyncing(true);
    let successCount = 0;
    
    for (const task of queue) {
      if (task.status !== 'PENDING' && task.status !== 'FAILED') continue;
      try {
        if (task.type === 'PAYMENT') {
          const result = await createPayment.mutateAsync({ data: task.payload });
          window.dispatchEvent(new CustomEvent('islamiya:offline-payment-synced', { detail: { taskId: task.id, result } }));
        } else if (task.type === 'SETTLEMENT') {
          await createSettlement.mutateAsync({ data: task.payload });
        }
        removeFromQueue(task.id);
        successCount++;
      } catch (error: any) {
        // If conflict or specific error, maybe we shouldn't fail permanently, but let user see it.
        updateTaskError(task.id, error?.message || "Sync failed");
      }
    }
    
    setIsSyncing(false);
    if (successCount > 0) {
      toast.success(`${successCount} টি অফলাইন কাজ সিঙ্ক হয়েছে (Offline tasks synced)`);
      queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListMembersQueryKey() });
    }
  }, [queue, isSyncing, createPayment, createSettlement, removeFromQueue, updateTaskError, queryClient]);

  useEffect(() => {
    if (isOnline && queue.length > 0) {
      syncQueue();
    }
  }, [isOnline, queue.length, syncQueue]);

  const clearQueue = useCallback(() => {
    setQueue([]);
  }, []);

  return (
    <SyncContext.Provider value={{
      isOnline, queue, addToQueue, removeFromQueue, syncQueue, isSyncing, clearQueue, pendingCount: queue.filter(q => q.status === 'PENDING').length
    }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}