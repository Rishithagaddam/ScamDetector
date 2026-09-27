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