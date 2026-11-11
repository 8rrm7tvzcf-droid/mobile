// Assicurazioni (SPEC 3.4 F-52..F-55, 6.3.7, 7.4): polizze, rinnovo, garanzie, rate e riepilogo.
// I promemoria (scadenza polizza 30/14/7/1/0 giorni, rate non pagate 7/1/0) li genera il motore (usecases/deadlines): qui le
// scritture riconciliano nella stessa transazione. Eventi: `data-changed` con scope `insurance` (+ `reminders` se cambiano).
export { addPolicy, deletePolicy, renewPolicy, restorePolicy, updatePolicy } from './policies';
export { markInstallmentPaid, unmarkInstallmentPaid } from './payments';
export { getInsuranceSummary, getPolicy, listPolicies } from './queries';
export {
  COVERAGE_CODES,
  COVERAGE_LABELS,
  INSTALLMENT_COUNTS,
  MAIN_COVERAGE,
  POLICY_KINDS,
  POLICY_KIND_LABELS,
} from './types';
export type {
  AddPolicyInput,
  AddPolicyResult,
  CoverageCode,
  CoverageInput,
  CoverageView,
  DeletePolicyResult,
  InstallmentCount,
  InstallmentResult,
  InstallmentsOverview,
  InstallmentState,
  InstallmentView,
  InsuranceSummary,
  ListPoliciesOptions,
  PaymentFrequency,
  PolicyDetail,
  PolicyExpiry,
  PolicyFields,
  PolicyKind,
  PolicyStatusKind,
  PolicySummary,
  RenewPolicyInput,
  RenewPolicyResult,
  UpdatePolicyInput,
} from './types';
