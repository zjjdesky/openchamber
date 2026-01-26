import { create } from 'zustand';
import type { GitHubUserSummary, RuntimeAPIs } from '@/lib/api/types';

export type GitHubAuthStatus = {
  connected: boolean;
  user?: GitHubUserSummary | null;
  scope?: string;
  error?: string;
};

type GitHubAuthStore = {
  status: GitHubAuthStatus | null;
  isLoading: boolean;
  hasChecked: boolean;
  setStatus: (status: GitHubAuthStatus | null) => void;
  refreshStatus: (
    runtimeGitHub?: RuntimeAPIs['github'],
    options?: { force?: boolean }
  ) => Promise<GitHubAuthStatus | null>;
};

const fetchStatus = async (
  runtimeGitHub?: RuntimeAPIs['github']
): Promise<GitHubAuthStatus> => {
  if (runtimeGitHub) {
    const payload = await runtimeGitHub.authStatus();
    return payload as GitHubAuthStatus;
  }

  const response = await fetch('/api/github/auth/status', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const payload = (await response.json().catch(() => null)) as GitHubAuthStatus | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error || response.statusText || 'Failed to load GitHub status');
  }
  return payload;
};

export const useGitHubAuthStore = create<GitHubAuthStore>((set, get) => ({
  status: null,
  isLoading: false,
  hasChecked: false,
  setStatus: (status) => set({ status, hasChecked: true }),
  refreshStatus: async (runtimeGitHub, options) => {
    const { hasChecked, status } = get();
    if (hasChecked && !options?.force) {
      return status;
    }

    set({ isLoading: true });
    try {
      const payload = await fetchStatus(runtimeGitHub);
      set({ status: payload, isLoading: false, hasChecked: true });
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        status: { connected: false, error: message },
        isLoading: false,
        hasChecked: true,
      });
      return null;
    }
  },
}));
