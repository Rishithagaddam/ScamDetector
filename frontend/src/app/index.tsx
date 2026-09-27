import { useEffect, useState, type ReactNode } from 'react';
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
  signOutCurrentUser,
  subscribeToAuthState,
  type PhoneConfirmation,
} from '@/lib/firebase-auth';
import {
  getUserProfile,
  saveUserProfile,
  type SavedUserProfile,
  type TrustedContactPayload,
} from '@/lib/api';
import { Colors, Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Step = 'phone' | 'otp' | 'profile' | 'done';
type Screen = 'loading' | 'onboarding' | 'dashboard';

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
  const errorCode = (error as { code?: string })?.code ?? '';
  const errorText = error instanceof Error ? error.message : String(error ?? '');

  if (errorCode.includes('billing-not-enabled') || errorText.includes('billing_not_enabled')) {
    return 'Firebase phone verification needs billing enabled for this project. Enable billing for scamdetector-2a501, then try again.';
  }

  if (errorCode.includes('too-many-requests')) {
    return 'Firebase temporarily blocked more verification requests. Wait and try again later, or use a Firebase test phone number.';
  }

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
  const [screen, setScreen] = useState<Screen>('loading');
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

  useEffect(() => {
    return subscribeToAuthState(async (user) => {
      if (!user) {
        setScreen('onboarding');
        return;
      }

      try {
        setLoading(true);
        setError('');
        setFirebaseUid(user.uid);
        setVerifiedPhoneNumber(user.phoneNumber ?? '');
        const idToken = await user.getIdToken();
        const response = await getUserProfile(user.uid, idToken);
        const profile = response.user;

        setSavedProfile(profile);
        setName(profile.name);
        setVerifiedPhoneNumber(profile.phoneNumber);
        setTrustedContacts(
          profile.trustedContacts.map((contact) => ({
            ...contact,
            id: createContactDraft().id,
          })),
        );
        setScreen('dashboard');
      } catch (nextError) {
        const status = (nextError as Error & { status?: number }).status;
        if (status === 404) {
          setStep('profile');
          setScreen('onboarding');
        } else {
          setError(getErrorMessage(nextError));
          setScreen('onboarding');
        }
      } finally {
        setLoading(false);
      }
    });
  }, []);

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
    setScreen('onboarding');
    setLoading(false);
    setError('');
  }

  async function handleSignOut() {
    try {
      setLoading(true);
      await signOutCurrentUser();
      resetFlow();
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      setLoading(false);
    }
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
      setScreen('dashboard');
      setStep('done');
      Alert.alert('Profile ready', 'Your profile and trusted contacts have been saved.');
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

  if (screen === 'loading') {
    return (
      <ThemedView style={[styles.page, { backgroundColor: theme.background }]}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.loadingState}>
            <ThemedText type="subtitle">Welcome back</ThemedText>
            <ThemedText themeColor="textSecondary">Loading your profile...</ThemedText>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (screen === 'dashboard' && savedProfile) {
    return (
      <ThemedView style={[styles.page, { backgroundColor: theme.background }]}>
        <SafeAreaView style={styles.safeArea}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.dashboardHeader}>
              <View>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Scam Detector
                </ThemedText>
                <ThemedText type="subtitle">Hello, {savedProfile.name}</ThemedText>
              </View>
              <ActionButton label="Sign out" onPress={handleSignOut} secondary disabled={loading} />
            </View>

            {error ? (
              <ThemedView type="backgroundElement" style={[styles.alert, { borderColor: '#E5484D' }]}>
                <ThemedText style={{ color: '#E5484D' }}>{error}</ThemedText>
              </ThemedView>
            ) : null}

            <ThemedView type="backgroundElement" style={styles.dashboardBanner}>
              <ThemedText type="smallBold">You are protected</ThemedText>
              <ThemedText themeColor="textSecondary">
                Your trusted contacts are ready to receive scam alerts.
              </ThemedText>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.dashboardCard}>
              <View style={styles.dashboardCardHeader}>
                <View>
                  <ThemedText type="smallBold">Your profile</ThemedText>
                  <ThemedText themeColor="textSecondary">{savedProfile.phoneNumber}</ThemedText>
                </View>
                <ActionButton
                  label="Edit"
                  onPress={() => {
                    setStep('profile');
                    setScreen('onboarding');
                    setError('');
                  }}
                  secondary
                />
              </View>
              <ThemedText themeColor="textSecondary">
                {savedProfile.trustedContacts.length} trusted contact
                {savedProfile.trustedContacts.length === 1 ? '' : 's'} added
              </ThemedText>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.dashboardCard}>
              <ThemedText type="smallBold">Trusted contacts</ThemedText>
              <View style={styles.dashboardContacts}>
                {savedProfile.trustedContacts.map((contact) => (
                  <View key={`${contact.name}-${contact.phoneNumber}`} style={styles.dashboardContactRow}>
                    <View style={styles.contactAvatar}>
                      <ThemedText type="smallBold">{contact.name.charAt(0).toUpperCase()}</ThemedText>
                    </View>
                    <View style={styles.dashboardContactDetails}>
                      <ThemedText type="smallBold">{contact.name}</ThemedText>
                      <ThemedText themeColor="textSecondary">{contact.phoneNumber}</ThemedText>
                    </View>
                  </View>
                ))}
              </View>
            </ThemedView>
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={[styles.page, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <View style={styles.hero}>
              <View style={[styles.badge, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Scam Detector
                </ThemedText>
              </View>
              <ThemedText type="title" style={styles.title}>
                Welcome back
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.description}>
                Sign in with your mobile number to help keep your calls and messages safer.
              </ThemedText>
            </View>

            <View style={styles.progressRow}>
              <StepPill active={step === 'phone'} label="Mobile number" />
              <StepPill active={step === 'otp'} label="Verification" />
              <StepPill active={step === 'profile' || step === 'done'} label="Your profile" />
            </View>

            {error ? (
              <ThemedView type="backgroundElement" style={[styles.alert, { borderColor: '#E5484D' }]}>
                <ThemedText style={{ color: '#E5484D' }}>{error}</ThemedText>
              </ThemedView>
            ) : null}

            {step === 'phone' ? (
              <SectionCard
                title="Enter your mobile number"
                subtitle="We will send you a one-time verification code.">
                <Field
                  label="Phone number"
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  placeholder="+919876543210"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                />
                <ActionButton label={loading ? 'Sending code...' : 'Continue'} onPress={handleSendOtp} disabled={loading} />
              </SectionCard>
            ) : null}

            {step === 'otp' ? (
              <SectionCard
                title="Enter verification code"
                subtitle={`We sent a 6-digit code to ${verifiedPhoneNumber || normalizePhoneNumber(phoneNumber)}.`}>
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
                    label={loading ? 'Checking...' : 'Verify and continue'}
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
                title="Set up your profile"
                subtitle="Add your details and people you trust.">
                <Field
                  label="Name"
                  value={name}
                  onChangeText={setName}
                  placeholder="Rishitha"
                  autoComplete="name"
                  textContentType="name"
                />
                <Field
                  label="Mobile number"
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

                <ActionButton
                  label="Add another contact"
                  onPress={addTrustedContact}
                  secondary
                  disabled={loading}
                />

                {step !== 'done' ? (
                  <View style={styles.inlineButtons}>
                    <ActionButton
                      label={loading ? 'Saving...' : 'Finish setup'}
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
                      Your profile is ready. Trusted contacts will receive alerts when needed.
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
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
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
  dashboardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  dashboardBanner: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.one,
    borderLeftWidth: 4,
    borderLeftColor: '#1D7CF2',
  },
  dashboardCard: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  dashboardCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  dashboardContacts: {
    gap: Spacing.three,
  },
  dashboardContactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  contactAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCEBFF',
  },
  dashboardContactDetails: {
    flex: 1,
    gap: Spacing.half,
  },
});
