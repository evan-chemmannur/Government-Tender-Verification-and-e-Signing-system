import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tenderApi } from '../services/api';
import toast from 'react-hot-toast';

export const useTenders = (filters = {}) => {
  return useQuery({
    queryKey: ['tenders', filters],
    queryFn: () => tenderApi.getTenders(filters),
    keepPreviousData: true
  });
};

export const useTender = (id) => {
  return useQuery({
    queryKey: ['tender', id],
    queryFn: () => tenderApi.getTenderById(id),
    enabled: !!id
  });
};

export const useTenderMutations = (id) => {
  const queryClient = useQueryClient();

  const invalidateTender = () => {
    if (id) {
      queryClient.invalidateQueries({ queryKey: ['tender', id] });
    }
    queryClient.invalidateQueries({ queryKey: ['tenders'] });
  };

  const submitMutation = useMutation({
    mutationFn: () => tenderApi.submitTender(id),
    onSuccess: () => {
      toast.success('Tender submitted for review');
      invalidateTender();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to submit tender');
    }
  });

  const startReviewMutation = useMutation({
    mutationFn: () => tenderApi.startReview(id),
    onSuccess: () => {
      toast.success('Review started');
      invalidateTender();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to start review');
    }
  });

  const approveMutation = useMutation({
    mutationFn: () => tenderApi.approveTender(id),
    onSuccess: () => {
      toast.success('Tender approved and pending signature');
      invalidateTender();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to approve tender');
    }
  });

  // Strict loading state, NO optimistic updates
  const signMutation = useMutation({
    mutationFn: () => tenderApi.signTender(id),
    onSuccess: () => {
      toast.success('Award digitally signed successfully ✅');
      invalidateTender();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to sign tender. Cryptographic error.');
    }
  });

  // Strict loading state, NO optimistic updates
  const revokeMutation = useMutation({
    mutationFn: (data) => tenderApi.revokeTender(id, data),
    onSuccess: () => {
      toast.success('Tender revoked successfully');
      invalidateTender();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to revoke tender');
    }
  });

  const createMutation = useMutation({
    mutationFn: tenderApi.createTender,
    onSuccess: () => {
      toast.success('Tender created successfully');
      queryClient.invalidateQueries({ queryKey: ['tenders'] });
    },
    onError: (err) => {
      const data = err.response?.data;
      if (data?.details && Array.isArray(data.details)) {
        const issues = data.details.map(d => `${d.field}: ${d.message}`).join(', ');
        toast.error(`Validation failed: ${issues}`);
      } else {
        toast.error(data?.error || 'Failed to create tender');
      }
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => tenderApi.deleteTender(id),
    onSuccess: () => {
      toast.success('Draft tender deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['tenders'] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to delete tender');
    }
  });

  return {
    submit: submitMutation.mutate,
    isSubmitting: submitMutation.isPending,
    
    startReview: startReviewMutation.mutate,
    isStartingReview: startReviewMutation.isPending,
    
    approve: approveMutation.mutate,
    isApproving: approveMutation.isPending,
    
    sign: signMutation.mutate,
    isSigning: signMutation.isPending, // Explicit loading state mapping
    
    revoke: revokeMutation.mutate,
    isRevoking: revokeMutation.isPending, // Explicit loading state mapping
    
    create: createMutation.mutate,
    isCreating: createMutation.isPending,

    remove: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending
  };
};
