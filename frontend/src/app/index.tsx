import { useState, type ReactNode } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  confirmPhoneOtp,
  getCurrentUser,
  requestPhoneOtp,
  type PhoneConfirmation,
} from '@/lib/firebase-auth';
import { saveUserProfile, type SavedUserProfile, type TrustedContactPayload } from '@/lib/api';
import { Colors, Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Step = 'phone' | 'otp' | 'profile' | 'done';

type ContactDraft = TrustedContactPayload & {
  id: string;
};

const DEFAULT_COUNTRY_CODE = '+91';

function createContactDraft(): ContactDraft {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    phoneNumber: '',
  };
}

function normalizePhoneNumber(value: string) {
  const stripped = value.trim().replace(/[\s()-]/g, '');
  if (!stripped) return '';
  if (stripped.startsWith('+')) return stripped;
  if (/^\d{10}$/.test(stripped)) return `${DEFAULT_COUNTRY_CODE}${stripped}`;
  return stripped;
}

function normalizeContact(contact: ContactDraft): TrustedContactPayload | null {
  const name = contact.name.trim();
  const phoneNumber = normalizePhoneNumber(contact.phoneNumber);

  if (!name || !phoneNumber) {
    return null;
  }

  return { name, phoneNumber };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'Something went wrong while saving the profile.';
}

function StepPill({ active, label }: { active: boolean; label: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.stepPill,
        {
          backgroundColor: active ? theme.text : theme.backgroundElement,
        },
      ]}>
      <ThemedText
        type="smallBold"
        style={{ color: active ? theme.background : theme.textSecondary }}>
        {label}
      </ThemedText>
    </View>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.card, { borderColor: theme.backgroundSelected }]}>
      <View style={styles.cardHeader}>
        <ThemedText type="subtitle">{title}</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.subtitle}>
          {subtitle}
        </ThemedText>
      </View>
      {children}
    </ThemedView>
  );
}

function ActionButton({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void | Promise<void>;
  secondary?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [pressed && !disabled && styles.pressed]}>
      <View
        style={[
          styles.button,
          {
            backgroundColor: secondary ? theme.backgroundSelected : '#1D7CF2',
            opacity: disabled ? 0.6 : 1,
          },
        ]}>
        <ThemedText type="smallBold" style={{ color: secondary ? theme.text : '#FFFFFF' }}>
          {label}
        </ThemedText>
      </View>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoComplete,
  textContentType,
  secureTextEntry,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'];
  autoComplete?: React.ComponentProps<typeof TextInput>['autoComplete'];
  textContentType?: React.ComponentProps<typeof TextInput>['textContentType'];
  secureTextEntry?: boolean;
  multiline?: boolean;
}) {
  const theme = useTheme();

  return (
    <View style={styles.fieldWrapper}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.light.textSecondary}
        keyboardType={keyboardType}
        autoComplete={autoComplete}
        textContentType={textContentType}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        style={[
          styles.input,
          {
            color: theme.text,
            borderColor: theme.backgroundSelected,
            backgroundColor: theme.background,
          },
          multiline && styles.multilineInput,
        ]}
      />
    </View>
  );
}

export default function HomeScreen() {
  const theme = useTheme();
  const [step, setStep] = useState<Step>('phone');
  const [phoneNumber, setPhoneNumber] = useState(DEFAULT_COUNTRY_CODE);
  const [verificationConfirmation, setVerificationConfirmation] = useState<PhoneConfirmation | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [firebaseUid, setFirebaseUid] = useState('');
  const [verifiedPhoneNumber, setVerifiedPhoneNumber] = useState('');
  const [name, setName] = useState('');
  const [trustedContacts, setTrustedContacts] = useState<ContactDraft[]>([createContactDraft()]);
  const [savedProfile, setSavedProfile] = useState<SavedUserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function resetFlow() {
    setStep('phone');
    setPhoneNumber(DEFAULT_COUNTRY_CODE);
    setVerificationConfirmation(null);
    setVerificationCode('');
    setFirebaseUid('');
    setVerifiedPhoneNumber('');
    setName('');
    setTrustedContacts([createContactDraft()]);
    setSavedProfile(null);
    setLoading(false);
    setError('');
  }

  async function handleSendOtp() {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    if (!normalizedPhone) {
      setError('Enter a phone number with a country code.');
      return;
    }

    if (Platform.OS === 'web') {
      setError('Phone OTP sign-in is supported in a native Expo development build, not Expo web.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const confirmation = await requestPhoneOtp(normalizedPhone);
      setVerificationConfirmation(confirmation);
      setVerifiedPhoneNumber(normalizedPhone);
      setStep('otp');
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (!verificationConfirmation) {
      setError('Request an OTP first.');
      return;
    }

    const code = verificationCode.trim();
    if (!code) {
      setError('Enter the OTP that Firebase sent to your phone.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const credential = await confirmPhoneOtp(verificationConfirmation, code);
      const user = credential.user;

      if (!user?.uid) {
        throw new Error('Firebase did not return a UID after OTP verification.');
      }

      setFirebaseUid(user.uid);
      setVerifiedPhoneNumber(user.phoneNumber ?? verifiedPhoneNumber);
      setStep('profile');
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveProfile() {
    const trimmedName = name.trim();
    const contacts = trustedContacts
      .map(normalizeContact)
      .filter((contact): contact is TrustedContactPayload => contact !== null);

    if (!trimmedName) {
      setError('Enter your name before saving the profile.');
      return;
    }

    if (!firebaseUid) {
      setError('Verify your phone number first.');
      return;
    }

    if (contacts.length === 0) {
      setError('Add at least one trusted contact.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const idToken = await getCurrentUser()?.getIdToken();

      const response = await saveUserProfile({
        firebaseUid,
        name: trimmedName,
        phoneNumber: verifiedPhoneNumber,
        trustedContacts: contacts,
        idToken,
      });

      setSavedProfile(response.user);
      setStep('done');
      Alert.alert('Profile saved', 'Your Firebase UID and trusted contacts were stored in MongoDB.');
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  function addTrustedContact() {
    setTrustedContacts((current) => [...current, createContactDraft()]);
  }

  function updateTrustedContact(id: string, key: keyof Omit<ContactDraft, 'id'>, value: string) {
    setTrustedContacts((current) =>
      current.map((contact) => (contact.id === id ? { ...contact, [key]: value } : contact)),
    );
  }

  function removeTrustedContact(id: string) {
    setTrustedContacts((current) => (current.length > 1 ? current.filter((contact) => contact.id !== id) : current));
  }

  return (
    <ThemedView style={[styles.page, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <View style={styles.hero}>
              <View style={[styles.badge, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Scam Detector onboarding
                </ThemedText>
              </View>
              <ThemedText type="title" style={styles.title}>
                Firebase phone auth to MongoDB profile save
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.description}>
                Verify a phone number with Firebase, collect the user profile and trusted contacts,
                then persist the Firebase UID in MongoDB Atlas.
              </ThemedText>
            </View>

            <View style={styles.progressRow}>
              <StepPill active={step === 'phone'} label="1. Phone" />
              <StepPill active={step === 'otp'} label="2. OTP" />
              <StepPill active={step === 'profile' || step === 'done'} label="3. Profile" />
            </View>

            {error ? (
              <ThemedView type="backgroundElement" style={[styles.alert, { borderColor: '#E5484D' }]}>
                <ThemedText style={{ color: '#E5484D' }}>{error}</ThemedText>
              </ThemedView>
            ) : null}

            {step === 'phone' ? (
              <SectionCard
                title="Step 1: verify the phone number"
                subtitle="Firebase sends the OTP to this number and creates the user UID after verification.">
                <Field
                  label="Phone number"
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  placeholder="+919876543210"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                />
                <ActionButton label={loading ? 'Sending OTP...' : 'Send OTP'} onPress={handleSendOtp} disabled={loading} />
              </SectionCard>
            ) : null}

            {step === 'otp' ? (
              <SectionCard
                title="Step 2: confirm the OTP"
                subtitle={`Code was sent to ${verifiedPhoneNumber || normalizePhoneNumber(phoneNumber)}.`}>
                <Field
                  label="OTP"
                  value={verificationCode}
                  onChangeText={setVerificationCode}
                  placeholder="123456"
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                />
                <View style={styles.inlineButtons}>
                  <ActionButton
                    label={loading ? 'Verifying...' : 'Verify OTP'}
                    onPress={handleVerifyOtp}
                    disabled={loading}
                  />
                  <ActionButton
                    label="Edit phone"
                    onPress={() => {
                      setStep('phone');
                      setError('');
                    }}
                    secondary
                    disabled={loading}
                  />
                </View>
              </SectionCard>
            ) : null}

            {step === 'profile' || step === 'done' ? (
              <SectionCard
                title="Step 3: create the profile"
                subtitle={`Firebase UID: ${firebaseUid || 'not verified yet'}`}>
                <Field
                  label="Name"
                  value={name}
                  onChangeText={setName}
                  placeholder="Rishitha"
                  autoComplete="name"
                  textContentType="name"
                />
                <Field
                  label="Verified phone number"
                  value={verifiedPhoneNumber}
                  onChangeText={setVerifiedPhoneNumber}
                  placeholder="+919876543210"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                />

                <View style={styles.contactsHeader}>
                  <View>
                    <ThemedText type="smallBold">Trusted contacts</ThemedText>
                    <ThemedText themeColor="textSecondary" type="small">
                      Add friends or family who should receive scam alerts.
                    </ThemedText>
                  </View>
                  <ActionButton label="Add contact" onPress={addTrustedContact} secondary disabled={loading} />
                </View>

                <View style={styles.contactsList}>
                  {trustedContacts.map((contact, index) => (
                    <ThemedView key={contact.id} type="background" style={styles.contactCard}>
                      <View style={styles.contactIndexRow}>
                        <ThemedText type="smallBold">Contact {index + 1}</ThemedText>
                        {trustedContacts.length > 1 ? (
                          <Pressable onPress={() => removeTrustedContact(contact.id)}>
                            <ThemedText type="smallBold" themeColor="textSecondary">
                              Remove
                            </ThemedText>
                          </Pressable>
                        ) : null}
                      </View>
                      <Field
                        label="Contact name"
                        value={contact.name}
                        onChangeText={(value) => updateTrustedContact(contact.id, 'name', value)}
                        placeholder="Mom"
                        autoComplete="name"
                        textContentType="name"
                      />
                      <Field
                        label="Contact phone"
                        value={contact.phoneNumber}
                        onChangeText={(value) => updateTrustedContact(contact.id, 'phoneNumber', value)}
                        placeholder="+919122334455"
                        keyboardType="phone-pad"
                        autoComplete="tel"
                        textContentType="telephoneNumber"
                      />
                    </ThemedView>
                  ))}
                </View>

                {step !== 'done' ? (
                  <View style={styles.inlineButtons}>
                    <ActionButton
                      label={loading ? 'Saving...' : 'Save to MongoDB'}
                      onPress={handleSaveProfile}
                      disabled={loading}
                    />
                    <ActionButton
                      label="Back"
                      onPress={() => setStep('otp')}
                      secondary
                      disabled={loading}
                    />
                  </View>
                ) : null}

                {step === 'done' && savedProfile ? (
                  <ThemedView type="backgroundSelected" style={styles.successPanel}>
                    <ThemedText type="smallBold">Saved profile</ThemedText>
                    <ThemedText themeColor="textSecondary" style={styles.successText}>
                      MongoDB stored the profile for {savedProfile.name} with UID {savedProfile.firebaseUid}.
                    </ThemedText>
                    <ActionButton label="Start over" onPress={resetFlow} secondary />
                  </ThemedView>
                ) : null}
              </SectionCard>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.four,
  },
  hero: {
    gap: Spacing.three,
    paddingBottom: Spacing.one,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 999,
  },
  title: {
    maxWidth: 680,
  },
  description: {
    maxWidth: 640,
  },
  progressRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  stepPill: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  alert: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  card: {
    borderWidth: 1,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  cardHeader: {
    gap: Spacing.one,
  },
  subtitle: {
    maxWidth: 620,
  },
  fieldWrapper: {
    gap: Spacing.one,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Fonts.sans,
  },
  multilineInput: {
    minHeight: 92,
    textAlignVertical: 'top',
  },
  button: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
  inlineButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  contactsHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  contactsList: {
    gap: Spacing.three,
  },
  contactCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  contactIndexRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  successPanel: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  successText: {
    maxWidth: 600,
  },
});
