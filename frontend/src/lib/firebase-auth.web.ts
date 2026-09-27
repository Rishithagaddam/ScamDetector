export type PhoneConfirmation = {
  confirm: (code: string) => Promise<never>;
};

export async function requestPhoneOtp() {
  throw new Error('Phone authentication is only supported in a native Expo development build.');
}

export async function confirmPhoneOtp() {
  throw new Error('Phone authentication is only supported in a native Expo development build.');
}

export function getCurrentUser() {
  return null;
}

export function subscribeToAuthState(callback: (user: null) => void) {
  callback(null);
  return () => undefined;
}

export async function signOutCurrentUser() {}