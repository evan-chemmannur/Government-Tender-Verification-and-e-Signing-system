import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../services/api';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

export const useAuth = () => {
  const queryClient = useQueryClient();

  const {
    data: authData,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authApi.getMe,
    retry: false, // Don't retry on 401
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const logoutMutation = useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      queryClient.clear();
      window.location.href = '/login';
    },
    onError: () => {
      // Even if API fails, clear locally
      queryClient.clear();
      window.location.href = '/login';
    }
  });

  const getLoginUrlMutation = useMutation({
    mutationFn: authApi.getLoginUrl
  });

  return {
    officer: authData?.data || authData,
    isAuthenticated: !!(authData?.data || authData),
    isLoading,
    isError,
    error,
    refetchAuth: refetch,
    logout: () => logoutMutation.mutate(),
    isLoggingOut: logoutMutation.isPending,
    getLoginUrl: getLoginUrlMutation.mutateAsync,
    isGettingLoginUrl: getLoginUrlMutation.isPending
  };
};

/**
 * Hook to proactively monitor session timeout
 */
export const useSessionMonitor = (isAuthenticated) => {
  const [showWarning, setShowWarning] = useState(false);
  const [remainingTime, setRemainingTime] = useState(null);
  
  const refreshMutation = useMutation({
    mutationFn: authApi.refreshSession,
    onSuccess: () => {
      setShowWarning(false);
      toast.success('Session extended securely');
    },
    onError: () => {
      toast.error('Failed to extend session. You may be logged out soon.');
    }
  });

  useEffect(() => {
    if (!isAuthenticated) {
      setShowWarning(false);
      return;
    }

    // Check status every 1 minute
    const interval = setInterval(async () => {
      try {
        const res = await authApi.getStatus();
        if (res?.data) {
          const idleSeconds = res.data.idleTimeoutSeconds;
          setRemainingTime(idleSeconds);
          
          // Show warning if less than 2 minutes (120 seconds) remaining
          if (idleSeconds > 0 && idleSeconds <= 120) {
            setShowWarning(true);
          } else {
            setShowWarning(false);
          }
        }
      } catch (err) {
        // If status fails (e.g. 401), interceptor will handle it
        console.error('Failed to check session status', err);
      }
    }, 60 * 1000); // 1 minute

    return () => clearInterval(interval);
  }, [isAuthenticated]);

  return {
    showWarning,
    remainingTime,
    extendSession: () => refreshMutation.mutate(),
    isExtending: refreshMutation.isPending
  };
};
