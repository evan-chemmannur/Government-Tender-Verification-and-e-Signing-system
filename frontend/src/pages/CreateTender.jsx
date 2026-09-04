import { useTenderMutations } from '../hooks/useTenders';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';

const schema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters'),
  description: z.string().min(20, 'Description must be at least 20 characters'),
  department: z.string().min(1, 'Department is required'),
  category: z.string().min(1, 'Category is required'),
  estimatedValue: z.number().min(100, 'Must be at least 100 INR'),
  submissionDeadline: z.string().min(1, 'Deadline is required'),
  awardedToName: z.string().optional(),
  awardedToGstin: z.string().optional(),
  awardedToEmail: z.string().email('Invalid email').optional().or(z.literal('')),
  contractStartDate: z.string().optional(),
  contractEndDate: z.string().optional()
});

import { useState } from 'react';
import { tenderApi } from '../services/api';

export default function CreateTender() {
  const navigate = useNavigate();
  const { create, isCreating } = useTenderMutations();
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(schema)
  });

  const onSubmit = (data) => {
    const finalData = {
      ...data,
      title: data.title?.trim(),
      description: data.description?.trim(),
      submissionDeadline: new Date(data.submissionDeadline).toISOString(),
      awardedToName: data.awardedToName?.trim() || undefined,
      awardedToGstin: data.awardedToGstin?.trim().toUpperCase() || undefined,
      awardedToEmail: data.awardedToEmail?.trim() || undefined,
      contractStartDate: data.contractStartDate || undefined,
      contractEndDate: data.contractEndDate || undefined
    };
    
    create(finalData, {
      onSuccess: async (res) => {
        if (selectedFile && res?.data?.id) {
          setIsUploading(true);
          try {
            await tenderApi.uploadDocument(res.data.id, selectedFile, 'TENDER_SPECIFICATION');
          } catch (e) {
            console.error("Document upload failed", e);
          } finally {
            setIsUploading(false);
            navigate('/tenders');
          }
        } else {
          navigate('/tenders');
        }
      }
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8">
        <h1 className="text-2xl font-bold text-navy mb-6">Draft New Tender</h1>
        
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
          {/* Section 1: Basic Info */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-800 border-b pb-2">1. Basic Information</h2>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tender Title</label>
              <input {...register('title')} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-navy focus:border-navy" />
              {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <textarea {...register('description')} rows={3} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-navy focus:border-navy" />
              {errors.description && <p className="text-red-500 text-xs mt-1">{errors.description.message}</p>}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Department</label>
                <select {...register('department')} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-navy focus:border-navy bg-white">
                  <option value="">Select Department...</option>
                  <option value="PUBLIC_WORKS_DEPARTMENT">Public Works Department</option>
                  <option value="MINISTRY_OF_DEFENCE">Ministry of Defence</option>
                  <option value="HEALTH_MINISTRY">Health Ministry</option>
                </select>
                {errors.department && <p className="text-red-500 text-xs mt-1">{errors.department.message}</p>}
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                <select {...register('category')} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-navy focus:border-navy bg-white">
                  <option value="">Select Category...</option>
                  <option value="WORKS">Works</option>
                  <option value="GOODS">Goods</option>
                  <option value="SERVICES">Services</option>
                  <option value="CONSULTANCY">Consultancy</option>
                </select>
                {errors.category && <p className="text-red-500 text-xs mt-1">{errors.category.message}</p>}
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Estimated Value (INR)</label>
                <input type="number" {...register('estimatedValue', { valueAsNumber: true })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-navy focus:border-navy" />
                {errors.estimatedValue && <p className="text-red-500 text-xs mt-1">{errors.estimatedValue.message}</p>}
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Submission Deadline</label>
                <input type="date" {...register('submissionDeadline')} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-navy focus:border-navy" />
                {errors.submissionDeadline && <p className="text-red-500 text-xs mt-1">{errors.submissionDeadline.message}</p>}
              </div>
            </div>
          </div>

          {/* Section 2: Award Details */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-800 border-b pb-2">2. Award Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Awarded To (Name)</label>
                <input {...register('awardedToName')} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-navy focus:border-navy" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Awarded To (GSTIN)</label>
                <input {...register('awardedToGstin')} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-navy focus:border-navy" placeholder="e.g. 27AAPFU0939F1ZV" />
                {errors.awardedToGstin && <p className="text-red-500 text-xs mt-1">{errors.awardedToGstin.message}</p>}
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Awardee Email</label>
                <input type="email" {...register('awardedToEmail')} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-navy focus:border-navy" placeholder="bidder@test.com" />
                {errors.awardedToEmail && <p className="text-red-500 text-xs mt-1">{errors.awardedToEmail.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Contract Start Date</label>
                <input type="date" {...register('contractStartDate')} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-navy focus:border-navy" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Contract End Date</label>
                <input type="date" {...register('contractEndDate')} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-navy focus:border-navy" />
              </div>
            </div>
          </div>

          {/* Section 3: Document Upload */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-800 border-b pb-2">3. Initial Document Upload</h2>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Upload Specification / Document</label>
              <input 
                type="file" 
                onChange={(e) => setSelectedFile(e.target.files[0])}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-navy focus:border-navy file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-navy file:text-white hover:file:bg-navy-light cursor-pointer" 
              />
            </div>
          </div>
          
          <div className="pt-4 flex justify-end gap-3">
            <button type="button" onClick={() => navigate(-1)} className="px-5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={isCreating || isUploading} className="px-5 py-2 text-sm font-medium text-white bg-navy rounded-lg hover:bg-navy-light disabled:opacity-70 flex items-center gap-2">
              {(isCreating || isUploading) && <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>}
              {isUploading ? 'Uploading...' : isCreating ? 'Creating...' : 'Create Draft'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
