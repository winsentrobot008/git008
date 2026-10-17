/**
 * The part of the shared biometric session a presentational panel may read.
 *
 * `ConsumerView` owns the one `useBiometricOwner()` instance. Panels receive these fields instead of
 * the hook itself, so a new surface cannot enroll or assert a second time behind the controller's back.
 */
export interface ConsoleBiometricState {
  readonly credentialId: string | null;
  readonly platformAuthenticator: boolean;
  readonly busy: boolean;
  readonly userVerified: boolean;
  readonly hardwareBacked: boolean;
  readonly onEnroll: () => void;
}
