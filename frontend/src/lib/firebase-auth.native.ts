import {
  getAuth,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from '@react-native-firebase/auth';

export type PhoneConfirmation = ConfirmationResult;

export async function requestPhoneOtp(phoneNumber: string) {
  return signInWithPhoneNumber(getAuth(), phoneNumber);
}

export async function confirmPhoneOtp(confirmation: PhoneConfirmation, code: string) {
  return confirmation.confirm(code);
}

export function getCurrentUser() {
  return getAuth().currentUser;
}