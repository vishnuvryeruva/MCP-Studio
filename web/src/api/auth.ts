import { apiClient } from './client';
import type { AuthResponse, CurrentUser } from '../types';

export function signup(payload: {
  organizationName: string;
  name: string;
  email: string;
  password: string;
}) {
  return apiClient.post<AuthResponse>('/public/auth/signup', payload).then((r) => r.data);
}

export function login(payload: { email: string; password: string }) {
  return apiClient.post<AuthResponse>('/public/auth/login', payload).then((r) => r.data);
}

export function fetchMe() {
  return apiClient.get<CurrentUser>('/users/me').then((r) => r.data);
}
