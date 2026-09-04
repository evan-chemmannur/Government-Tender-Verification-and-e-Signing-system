// ─────────────────────────────────────────────────────────
// frontend/src/tests/Verify.test.jsx — Verification page tests
//
// Tests: Valid VC → GENUINE, Tampered VC → TAMPERED,
//        Revoked VC → REVOKED, Network errors
// ─────────────────────────────────────────────────────────

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import axios from 'axios';
import { vi, describe, test, expect, afterEach } from 'vitest';
import Verify from '../pages/Verify';

// Mock axios
vi.mock('axios');

describe('Task 17: Verification Page Flow', () => {

  const renderComponent = (id) => {
    return render(
      <MemoryRouter initialEntries={[`/verify/${id}`]}>
        <Routes>
          <Route path="/verify/:id" element={<Verify />} />
        </Routes>
      </MemoryRouter>
    );
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── GENUINE ──────────────────────────────────────────────
  test('Shows GENUINE for a valid VC', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        status: 'GENUINE',
        details: {
          id: 'vc_123',
          issueDate: '2026-01-01',
          tenderTitle: 'Road Construction',
        },
      },
    });

    renderComponent('vc_123');

    // Page should show the tender ID
    expect(screen.getByText(/vc_123/i)).toBeInTheDocument();

    // Click verify button
    fireEvent.click(screen.getByText('Verify Now'));

    // Should show loading state
    expect(screen.getByText('Verifying...')).toBeInTheDocument();

    // Wait for result
    await waitFor(() => {
      expect(screen.getByText('GENUINE')).toBeInTheDocument();
    });

    // Ensure axios was called with the right URL
    expect(axios.get).toHaveBeenCalledWith('/api/public/verify/vc_123');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  // ─── TAMPERED ─────────────────────────────────────────────
  test('Shows TAMPERED for a manipulated VC', async () => {
    // API returns error response with TAMPERED status
    axios.get.mockRejectedValueOnce({
      response: {
        data: {
          status: 'TAMPERED',
          error: 'Cryptographic signature verification failed',
        },
      },
    });

    renderComponent('vc_tampered');

    fireEvent.click(screen.getByText('Verify Now'));

    await waitFor(() => {
      expect(screen.getByText('TAMPERED')).toBeInTheDocument();
    });

    expect(axios.get).toHaveBeenCalledWith('/api/public/verify/vc_tampered');
  });

  // ─── REVOKED ──────────────────────────────────────────────
  test('Shows REVOKED for a revoked VC', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        status: 'REVOKED',
        details: {
          id: 'vc_revoked',
          reason: 'FRAUD_DETECTED',
          revokedAt: '2026-06-15T00:00:00Z',
        },
      },
    });

    renderComponent('vc_revoked');

    fireEvent.click(screen.getByText('Verify Now'));

    await waitFor(() => {
      expect(screen.getByText('REVOKED')).toBeInTheDocument();
    });

    expect(axios.get).toHaveBeenCalledWith('/api/public/verify/vc_revoked');
  });

  // ─── Network Error ────────────────────────────────────────
  test('Handles network errors gracefully', async () => {
    axios.get.mockRejectedValueOnce(new Error('Network error'));

    renderComponent('vc_123');

    fireEvent.click(screen.getByText('Verify Now'));

    await waitFor(() => {
      expect(
        screen.getByText('Failed to connect to verification server')
      ).toBeInTheDocument();
    });
  });

  // ─── Verify Button State ──────────────────────────────────
  test('Verify button is disabled during loading', async () => {
    // Make axios hang (never resolve) to test loading state
    let resolvePromise;
    axios.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    renderComponent('vc_loading');

    const button = screen.getByText('Verify Now');
    fireEvent.click(button);

    // Button should show loading text and be disabled
    expect(screen.getByText('Verifying...')).toBeInTheDocument();
    expect(screen.getByText('Verifying...').closest('button')).toBeDisabled();

    // Clean up by resolving
    resolvePromise({ data: { status: 'GENUINE' } });
    await waitFor(() => {
      expect(screen.getByText('GENUINE')).toBeInTheDocument();
    });
  });

  // ─── Document ID Display ──────────────────────────────────
  test('Displays document ID from URL params', () => {
    renderComponent('test-doc-id-123');
    expect(screen.getByText('test-doc-id-123')).toBeInTheDocument();
  });

  // ─── Server Error Response ────────────────────────────────
  test('Handles server error with error response body', async () => {
    axios.get.mockRejectedValueOnce({
      response: {
        status: 500,
        data: {
          status: 'ERROR',
          error: 'Internal server error',
        },
      },
    });

    renderComponent('vc_error');

    fireEvent.click(screen.getByText('Verify Now'));

    await waitFor(() => {
      // The component sets result from err.response.data
      expect(screen.getByText('ERROR')).toBeInTheDocument();
    });
  });
});
