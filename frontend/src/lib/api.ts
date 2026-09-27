import { Platform } from 'react-native';

export type TrustedContactPayload = {
  name: string;
  phoneNumber: string;
};

export type SaveUserProfilePayload = {
  firebaseUid: string;
  name: string;
  phoneNumber: string;
  trustedContacts: TrustedContactPayload[];
  idToken?: string;
};

export type SavedUserProfile = {
  _id: string;
  firebaseUid: string;
  name: string;
  phoneNumber: string;
  trustedContacts: TrustedContactPayload[];
  createdAt: string;
  updatedAt: string;
};

function getApiBaseUrl() {
  const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, '');
  }

  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:3000';
  }

  return 'http://localhost:3000';
}

export async function saveUserProfile(payload: SaveUserProfilePayload) {
  const response = await fetch(`${getApiBaseUrl()}/api/users/profile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(payload.idToken ? { Authorization: `Bearer ${payload.idToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => null)) as
    | { message?: string; user?: SavedUserProfile }
    | null;

  if (!response.ok) {
    throw new Error(body?.message ?? `Request failed with status ${response.status}`);
  }

  return body as { user: SavedUserProfile };
}

export async function getUserProfile(firebaseUid: string, idToken?: string) {
  const response = await fetch(`${getApiBaseUrl()}/api/users/profile/${encodeURIComponent(firebaseUid)}`, {
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
  });

  const body = (await response.json().catch(() => null)) as
    | { message?: string; user?: SavedUserProfile }
    | null;

  if (!response.ok) {
    const error = new Error(body?.message ?? `Request failed with status ${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return body as { user: SavedUserProfile };
}