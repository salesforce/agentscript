/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { parse } from '@agentscript/parser';
import { Dialect } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import type { Diagnostic } from '@agentscript/types';
import { AgentforceSchema } from '@agentscript/agentforce-dialect';
import { compile } from '../src/compile.js';
import type { ParsedAgentforce } from '../src/parsed-types.js';
import {
  readFixtureSource,
  readExpectedYaml,
  toParsedAgentforce,
} from './test-utils.js';

function parseWithDiagnostics(source: string): {
  ast: ParsedAgentforce;
  diagnostics: Diagnostic[];
} {
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;
  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, AgentforceSchema);
  return {
    ast: toParsedAgentforce(result.value),
    diagnostics: result.diagnostics,
  };
}

function errorDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter(d => d.severity === DiagnosticSeverity.Error);
}

function formatDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics
    .map(
      d =>
        `  [${d.severity === DiagnosticSeverity.Error ? 'ERROR' : 'WARN'}] ${d.message} (${d.range.start.line}:${d.range.start.character})`
    )
    .join('\n');
}

const FIXTURE_PAIRS: [string, string][] = [
  // Original fixtures
  ['hello_world.agent', 'hello_world_dsl.yaml'],
  ['weather.agent', 'weather_dsl.yaml'],
  ['deep_supervision.agent', 'deep_supervision_dsl.yaml'],
  ['router_node_template.agent', 'router_node_template_dsl.yaml'],
  ['matrix.agent', 'matrix_dsl.yaml'],
  ['multi-line-descriptions.agent', 'multi_line_descriptions_dsl.yaml'],
  // New fixtures from Python repo
  ['appointment_scheduler.agent', 'appointment_scheduler_dsl.yaml'],
  ['basic_topic.agent', 'basic_topic_dsl.yaml'],
  ['case_escalation_bot.agent', 'case_escalation_bot_dsl.yaml'],
  ['claim_processing_assistant.agent', 'claim_processing_assistant_dsl.yaml'],
  ['conditional_runtime_test.agent', 'conditional_runtime_test_dsl.yaml'],
  ['csa.agent', 'csa_dsl.yaml'],
  ['employee_agent.agent', 'employee_agent_dsl.yaml'],
  ['field_service_scheduler.agent', 'field_service_scheduler_dsl.yaml'],
  ['hyperclassifier_model.agent', 'hyperclassifier_model_dsl.yaml'],
  ['inventory_management_bot.agent', 'inventory_management_bot_dsl.yaml'],
  ['knowledge_search_assistant.agent', 'knowledge_search_assistant_dsl.yaml'],
  ['lead_qualification_bot.agent', 'lead_qualification_bot_dsl.yaml'],
  ['loan_application_assistant.agent', 'loan_application_assistant_dsl.yaml'],
  ['null_variable_assignments.agent', 'null_variable_assignments_dsl.yaml'],
  ['opportunity_management_bot.agent', 'opportunity_management_bot_dsl.yaml'],
  ['order_tracking_assistant.agent', 'order_tracking_assistant_dsl.yaml'],
  ['post_action_conditionals.agent', 'post_action_conditionals_dsl.yaml'],
  [
    'pricing_configuration_assistant.agent',
    'pricing_configuration_assistant_dsl.yaml',
  ],
  ['quality_control_assistant.agent', 'quality_control_assistant_dsl.yaml'],
  [
    'service_appointment_scheduler.agent',
    'service_appointment_scheduler_dsl.yaml',
  ],
  ['start_template.agent', 'start_template_dsl.yaml'],
  ['two_topic.agent', 'two_topic_dsl.yaml'],
  // Integration scripts from Python repo
  ['helloworld1.agent', 'helloworld1_dsl.yaml'],
  ['helloworld2.agent', 'helloworld2_dsl.yaml'],
  ['simple-ordering.agent', 'simple_ordering_dsl.yaml'],
  ['weather-v0.1.0.agent', 'weather_v0.1.0_dsl.yaml'],
  // Numbered fixtures (100 complex scripts)
  ['001_loan_origination.agent', '001_loan_origination_dsl.yaml'],
  ['002_mortgage_processing.agent', '002_mortgage_processing_dsl.yaml'],
  ['003_credit_scoring.agent', '003_credit_scoring_dsl.yaml'],
  ['004_investment_portfolio.agent', '004_investment_portfolio_dsl.yaml'],
  ['005_treasury_management.agent', '005_treasury_management_dsl.yaml'],
  ['006_fraud_detection.agent', '006_fraud_detection_dsl.yaml'],
  ['007_tax_compliance.agent', '007_tax_compliance_dsl.yaml'],
  ['008_payment_reconciliation.agent', '008_payment_reconciliation_dsl.yaml'],
  ['009_wealth_advisory.agent', '009_wealth_advisory_dsl.yaml'],
  ['010_risk_assessment.agent', '010_risk_assessment_dsl.yaml'],
  ['011_patient_intake.agent', '011_patient_intake_dsl.yaml'],
  ['012_clinical_trial.agent', '012_clinical_trial_dsl.yaml'],
  ['013_prescription_mgmt.agent', '013_prescription_mgmt_dsl.yaml'],
  ['014_insurance_claim_health.agent', '014_insurance_claim_health_dsl.yaml'],
  ['015_appointment_scheduling.agent', '015_appointment_scheduling_dsl.yaml'],
  ['016_lab_results.agent', '016_lab_results_dsl.yaml'],
  ['017_discharge_planning.agent', '017_discharge_planning_dsl.yaml'],
  ['018_referral_management.agent', '018_referral_management_dsl.yaml'],
  ['019_chronic_care.agent', '019_chronic_care_dsl.yaml'],
  ['020_mental_health.agent', '020_mental_health_dsl.yaml'],
  ['021_order_fulfillment.agent', '021_order_fulfillment_dsl.yaml'],
  ['022_inventory_control.agent', '022_inventory_control_dsl.yaml'],
  ['023_customer_loyalty.agent', '023_customer_loyalty_dsl.yaml'],
  ['024_product_return.agent', '024_product_return_dsl.yaml'],
  ['025_price_matching.agent', '025_price_matching_dsl.yaml'],
  ['026_gift_registry.agent', '026_gift_registry_dsl.yaml'],
  ['027_subscription_mgmt.agent', '027_subscription_mgmt_dsl.yaml'],
  ['028_vendor_onboarding.agent', '028_vendor_onboarding_dsl.yaml'],
  ['029_flash_sale.agent', '029_flash_sale_dsl.yaml'],
  ['030_warranty_processing.agent', '030_warranty_processing_dsl.yaml'],
  ['031_incident_mgmt.agent', '031_incident_mgmt_dsl.yaml'],
  ['032_change_request.agent', '032_change_request_dsl.yaml'],
  ['033_asset_tracking.agent', '033_asset_tracking_dsl.yaml'],
  ['034_license_mgmt.agent', '034_license_mgmt_dsl.yaml'],
  ['035_security_audit.agent', '035_security_audit_dsl.yaml'],
  ['036_capacity_planning.agent', '036_capacity_planning_dsl.yaml'],
  ['037_deploy_pipeline.agent', '037_deploy_pipeline_dsl.yaml'],
  ['038_backup_recovery.agent', '038_backup_recovery_dsl.yaml'],
  ['039_network_monitoring.agent', '039_network_monitoring_dsl.yaml'],
  ['040_access_control.agent', '040_access_control_dsl.yaml'],
  ['041_recruitment_pipeline.agent', '041_recruitment_pipeline_dsl.yaml'],
  ['042_employee_onboarding.agent', '042_employee_onboarding_dsl.yaml'],
  ['043_performance_review.agent', '043_performance_review_dsl.yaml'],
  ['044_leave_management.agent', '044_leave_management_dsl.yaml'],
  ['045_compensation_planning.agent', '045_compensation_planning_dsl.yaml'],
  ['046_benefits_enrollment.agent', '046_benefits_enrollment_dsl.yaml'],
  ['047_training_mgmt.agent', '047_training_mgmt_dsl.yaml'],
  ['048_succession_planning.agent', '048_succession_planning_dsl.yaml'],
  ['049_exit_process.agent', '049_exit_process_dsl.yaml'],
  ['050_timesheet_approval.agent', '050_timesheet_approval_dsl.yaml'],
  ['051_policy_underwriting.agent', '051_policy_underwriting_dsl.yaml'],
  ['052_claims_adjudication.agent', '052_claims_adjudication_dsl.yaml'],
  ['053_renewal_processing.agent', '053_renewal_processing_dsl.yaml'],
  ['054_premium_calculation.agent', '054_premium_calculation_dsl.yaml'],
  ['055_coverage_verification.agent', '055_coverage_verification_dsl.yaml'],
  ['056_beneficiary_mgmt.agent', '056_beneficiary_mgmt_dsl.yaml'],
  ['057_damage_assessment.agent', '057_damage_assessment_dsl.yaml'],
  ['058_fraud_investigation.agent', '058_fraud_investigation_dsl.yaml'],
  ['059_compliance_review.agent', '059_compliance_review_dsl.yaml'],
  ['060_reinsurance_mgmt.agent', '060_reinsurance_mgmt_dsl.yaml'],
  ['061_property_listing.agent', '061_property_listing_dsl.yaml'],
  ['062_tenant_screening.agent', '062_tenant_screening_dsl.yaml'],
  ['063_lease_management.agent', '063_lease_management_dsl.yaml'],
  ['064_maintenance_request.agent', '064_maintenance_request_dsl.yaml'],
  ['065_property_valuation.agent', '065_property_valuation_dsl.yaml'],
  ['066_commission_tracking.agent', '066_commission_tracking_dsl.yaml'],
  ['067_showing_scheduler.agent', '067_showing_scheduler_dsl.yaml'],
  ['068_closing_process.agent', '068_closing_process_dsl.yaml'],
  ['069_inspection_mgmt.agent', '069_inspection_mgmt_dsl.yaml'],
  ['070_hoa_compliance.agent', '070_hoa_compliance_dsl.yaml'],
  ['071_booking_management.agent', '071_booking_management_dsl.yaml'],
  ['072_itinerary_planning.agent', '072_itinerary_planning_dsl.yaml'],
  ['073_loyalty_rewards.agent', '073_loyalty_rewards_dsl.yaml'],
  ['074_cancellation_processing.agent', '074_cancellation_processing_dsl.yaml'],
  ['075_group_travel.agent', '075_group_travel_dsl.yaml'],
  ['076_travel_insurance.agent', '076_travel_insurance_dsl.yaml'],
  ['077_visa_application.agent', '077_visa_application_dsl.yaml'],
  ['078_expense_reporting.agent', '078_expense_reporting_dsl.yaml'],
  ['079_hotel_management.agent', '079_hotel_management_dsl.yaml'],
  ['080_flight_rebooking.agent', '080_flight_rebooking_dsl.yaml'],
  ['081_production_scheduling.agent', '081_production_scheduling_dsl.yaml'],
  ['082_quality_inspection.agent', '082_quality_inspection_dsl.yaml'],
  ['083_supply_chain_mgmt.agent', '083_supply_chain_mgmt_dsl.yaml'],
  ['084_equipment_maintenance.agent', '084_equipment_maintenance_dsl.yaml'],
  ['085_raw_material.agent', '085_raw_material_dsl.yaml'],
  ['086_batch_tracking.agent', '086_batch_tracking_dsl.yaml'],
  ['087_safety_compliance.agent', '087_safety_compliance_dsl.yaml'],
  ['088_energy_management.agent', '088_energy_management_dsl.yaml'],
  ['089_warehouse_ops.agent', '089_warehouse_ops_dsl.yaml'],
  ['090_shipping_logistics.agent', '090_shipping_logistics_dsl.yaml'],
  ['091_permit_processing.agent', '091_permit_processing_dsl.yaml'],
  ['092_license_renewal.agent', '092_license_renewal_dsl.yaml'],
  ['093_benefit_application.agent', '093_benefit_application_dsl.yaml'],
  ['094_compliance_enforcement.agent', '094_compliance_enforcement_dsl.yaml'],
  ['095_public_records.agent', '095_public_records_dsl.yaml'],
  ['096_grant_management.agent', '096_grant_management_dsl.yaml'],
  ['097_voter_registration.agent', '097_voter_registration_dsl.yaml'],
  ['098_emergency_response.agent', '098_emergency_response_dsl.yaml'],
  ['099_procurement.agent', '099_procurement_dsl.yaml'],
  ['100_citizen_feedback.agent', '100_citizen_feedback_dsl.yaml'],
  // Edge case fixtures (100 scripts)
  ['edge_action_after_reasoning.agent', 'edge_action_after_reasoning_dsl.yaml'],
  ['edge_action_apex.agent', 'edge_action_apex_dsl.yaml'],
  ['edge_action_api.agent', 'edge_action_api_dsl.yaml'],
  ['edge_action_available_when.agent', 'edge_action_available_when_dsl.yaml'],
  [
    'edge_action_before_reasoning.agent',
    'edge_action_before_reasoning_dsl.yaml',
  ],
  ['edge_action_complex_types.agent', 'edge_action_complex_types_dsl.yaml'],
  ['edge_action_confirmation.agent', 'edge_action_confirmation_dsl.yaml'],
  ['edge_action_flow.agent', 'edge_action_flow_dsl.yaml'],
  ['edge_action_invocable.agent', 'edge_action_invocable_dsl.yaml'],
  ['edge_action_list_io.agent', 'edge_action_list_io_dsl.yaml'],
  ['edge_action_many.agent', 'edge_action_many_dsl.yaml'],
  ['edge_action_mixed_targets.agent', 'edge_action_mixed_targets_dsl.yaml'],
  ['edge_action_no_inputs.agent', 'edge_action_no_inputs_dsl.yaml'],
  ['edge_action_no_outputs.agent', 'edge_action_no_outputs_dsl.yaml'],
  ['edge_action_set_many.agent', 'edge_action_set_many_dsl.yaml'],
  [
    'edge_action_set_variables_util.agent',
    'edge_action_set_variables_util_dsl.yaml',
  ],
  [
    'edge_action_standard_invocable.agent',
    'edge_action_standard_invocable_dsl.yaml',
  ],
  ['edge_action_with_ellipsis.agent', 'edge_action_with_ellipsis_dsl.yaml'],
  ['edge_action_with_literals.agent', 'edge_action_with_literals_dsl.yaml'],
  ['edge_action_with_variables.agent', 'edge_action_with_variables_dsl.yaml'],
  [
    'edge_cond_action_conditional.agent',
    'edge_cond_action_conditional_dsl.yaml',
  ],
  ['edge_cond_after_reasoning.agent', 'edge_cond_after_reasoning_dsl.yaml'],
  ['edge_cond_before_reasoning.agent', 'edge_cond_before_reasoning_dsl.yaml'],
  ['edge_cond_boolean_ops.agent', 'edge_cond_boolean_ops_dsl.yaml'],
  ['edge_cond_comparison_ops.agent', 'edge_cond_comparison_ops_dsl.yaml'],
  ['edge_cond_if_else.agent', 'edge_cond_if_else_dsl.yaml'],
  ['edge_cond_is_none.agent', 'edge_cond_is_none_dsl.yaml'],
  ['edge_cond_multiple_branches.agent', 'edge_cond_multiple_branches_dsl.yaml'],
  ['edge_cond_nested.agent', 'edge_cond_nested_dsl.yaml'],
  [
    'edge_cond_transition_conditional.agent',
    'edge_cond_transition_conditional_dsl.yaml',
  ],
  ['edge_config_all_fields.agent', 'edge_config_all_fields_dsl.yaml'],
  ['edge_config_debug.agent', 'edge_config_debug_dsl.yaml'],
  ['edge_config_enhanced_logs.agent', 'edge_config_enhanced_logs_dsl.yaml'],
  ['edge_config_minimal.agent', 'edge_config_minimal_dsl.yaml'],
  ['edge_conn_all_surfaces.agent', 'edge_conn_all_surfaces_dsl.yaml'],
  ['edge_conn_custom.agent', 'edge_conn_custom_dsl.yaml'],
  // TODO: empty keyword not yet supported in grammar/dialect
  // ['edge_conn_empty_keyword.agent', 'edge_conn_empty_keyword_dsl.yaml'],
  ['edge_conn_messaging.agent', 'edge_conn_messaging_dsl.yaml'],
  ['edge_conn_messaging_full.agent', 'edge_conn_messaging_full_dsl.yaml'],
  ['edge_conn_messaging_routing.agent', 'edge_conn_messaging_routing_dsl.yaml'],
  ['edge_conn_multiple.agent', 'edge_conn_multiple_dsl.yaml'],
  ['edge_conn_routing.agent', 'edge_conn_routing_dsl.yaml'],
  ['edge_conn_service_email.agent', 'edge_conn_service_email_dsl.yaml'],
  ['edge_conn_slack.agent', 'edge_conn_slack_dsl.yaml'],
  ['edge_conn_slack_routing.agent', 'edge_conn_slack_routing_dsl.yaml'],
  ['edge_conn_voice.agent', 'edge_conn_voice_dsl.yaml'],
  [
    'edge_directive_hyperclassifier.agent',
    'edge_directive_hyperclassifier_dsl.yaml',
  ],
  ['edge_education_enrollment.agent', 'edge_education_enrollment_dsl.yaml'],
  ['edge_employee_agent.agent', 'edge_employee_agent_dsl.yaml'],
  ['edge_empty_messages.agent', 'edge_empty_messages_dsl.yaml'],
  ['edge_escalation_basic.agent', 'edge_escalation_basic_dsl.yaml'],
  ['edge_escalation_conditional.agent', 'edge_escalation_conditional_dsl.yaml'],
  ['edge_escalation_in_after.agent', 'edge_escalation_in_after_dsl.yaml'],
  ['edge_escalation_multi_topic.agent', 'edge_escalation_multi_topic_dsl.yaml'],
  ['edge_escalation_with_desc.agent', 'edge_escalation_with_desc_dsl.yaml'],
  ['edge_financial_kyc.agent', 'edge_financial_kyc_dsl.yaml'],
  ['edge_healthcare_scheduling.agent', 'edge_healthcare_scheduling_dsl.yaml'],
  ['edge_hr_onboarding.agent', 'edge_hr_onboarding_dsl.yaml'],
  [
    'edge_hyperclassifier_actions.agent',
    'edge_hyperclassifier_actions_dsl.yaml',
  ],
  ['edge_hyperclassifier_basic.agent', 'edge_hyperclassifier_basic_dsl.yaml'],
  [
    'edge_hyperclassifier_knowledge.agent',
    'edge_hyperclassifier_knowledge_dsl.yaml',
  ],
  ['edge_insurance_claims.agent', 'edge_insurance_claims_dsl.yaml'],
  ['edge_knowledge_and_actions.agent', 'edge_knowledge_and_actions_dsl.yaml'],
  ['edge_knowledge_basic.agent', 'edge_knowledge_basic_dsl.yaml'],
  ['edge_knowledge_citations.agent', 'edge_knowledge_citations_dsl.yaml'],
  [
    'edge_knowledge_escalation_combo.agent',
    'edge_knowledge_escalation_combo_dsl.yaml',
  ],
  ['edge_knowledge_in_topic.agent', 'edge_knowledge_in_topic_dsl.yaml'],
  ['edge_locale_multiple.agent', 'edge_locale_multiple_dsl.yaml'],
  ['edge_locale_non_us.agent', 'edge_locale_non_us_dsl.yaml'],
  ['edge_logistics_tracking.agent', 'edge_logistics_tracking_dsl.yaml'],
  ['edge_long_messages.agent', 'edge_long_messages_dsl.yaml'],
  ['edge_many_topics.agent', 'edge_many_topics_dsl.yaml'],
  ['edge_message_variables.agent', 'edge_message_variables_dsl.yaml'],
  ['edge_real_estate_inquiry.agent', 'edge_real_estate_inquiry_dsl.yaml'],
  [
    'edge_restaurant_reservations.agent',
    'edge_restaurant_reservations_dsl.yaml',
  ],
  ['edge_retail_returns.agent', 'edge_retail_returns_dsl.yaml'],
  ['edge_router_basic.agent', 'edge_router_basic_dsl.yaml'],
  ['edge_router_complex.agent', 'edge_router_complex_dsl.yaml'],
  ['edge_router_escalation.agent', 'edge_router_escalation_dsl.yaml'],
  ['edge_router_many_routes.agent', 'edge_router_many_routes_dsl.yaml'],
  ['edge_router_model_config.agent', 'edge_router_model_config_dsl.yaml'],
  ['edge_router_with_topics.agent', 'edge_router_with_topics_dsl.yaml'],
  ['edge_single_topic.agent', 'edge_single_topic_dsl.yaml'],
  ['edge_telecom_support.agent', 'edge_telecom_support_dsl.yaml'],
  ['edge_topic_circular.agent', 'edge_topic_circular_dsl.yaml'],
  ['edge_topic_deep_chain.agent', 'edge_topic_deep_chain_dsl.yaml'],
  ['edge_topic_escalation_flow.agent', 'edge_topic_escalation_flow_dsl.yaml'],
  ['edge_topic_hub.agent', 'edge_topic_hub_dsl.yaml'],
  ['edge_topic_long_description.agent', 'edge_topic_long_description_dsl.yaml'],
  ['edge_topic_minimal.agent', 'edge_topic_minimal_dsl.yaml'],
  ['edge_topic_no_actions.agent', 'edge_topic_no_actions_dsl.yaml'],
  ['edge_topic_no_reasoning.agent', 'edge_topic_no_reasoning_dsl.yaml'],
  ['edge_vars_all_types.agent', 'edge_vars_all_types_dsl.yaml'],
  ['edge_vars_custom_fields.agent', 'edge_vars_custom_fields_dsl.yaml'],
  ['edge_vars_defaults.agent', 'edge_vars_defaults_dsl.yaml'],
  ['edge_vars_linked_types.agent', 'edge_vars_linked_types_dsl.yaml'],
  ['edge_vars_lists.agent', 'edge_vars_lists_dsl.yaml'],
  ['edge_vars_many.agent', 'edge_vars_many_dsl.yaml'],
  ['edge_vars_mixed.agent', 'edge_vars_mixed_dsl.yaml'],
  ['edge_vars_no_description.agent', 'edge_vars_no_description_dsl.yaml'],
  ['edge_vars_null_defaults.agent', 'edge_vars_null_defaults_dsl.yaml'],
  ['edge_vars_object_complex.agent', 'edge_vars_object_complex_dsl.yaml'],
  // Connected agent fixtures
  ['connected_subagent_tool.agent', 'connected_subagent_tool_dsl.yaml'],
  [
    'router_with_connected_agents.agent',
    'router_with_connected_agents_dsl.yaml',
  ],
  // New syntax fixtures
  ['new_syntax_two_topic.agent', 'new_syntax_two_topic_dsl.yaml'],
  ['new_syntax_action_flow.agent', 'new_syntax_action_flow_dsl.yaml'],
  ['new_syntax_hyperclassifier.agent', 'new_syntax_hyperclassifier_dsl.yaml'],
  ['mixed_syntax_multi_topic.agent', 'mixed_syntax_multi_topic_dsl.yaml'],
  // Context block fixtures
  ['context_memory_agent.agent', 'context_memory_agent_dsl.yaml'],
  // Constant value fixtures
  ['constant_values_edge_cases.agent', 'constant_values_edge_cases_dsl.yaml'],
  ['constant_values_literals.agent', 'constant_values_literals_dsl.yaml'],
  ['constant_values_mixed.agent', 'constant_values_mixed_dsl.yaml'],
];

function findDiffs(actual: unknown, expected: unknown, path: string): string[] {
  const diffs: string[] = [];
  if (actual === expected) return diffs;
  if (actual === null && expected === null) return diffs;
  if (actual === undefined && expected === undefined) return diffs;
  if (typeof actual !== typeof expected) {
    diffs.push(
      `${path}: type mismatch (actual: ${typeof actual}, expected: ${typeof expected})`
    );
    return diffs;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) {
      diffs.push(
        `${path}: array length (actual: ${actual.length}, expected: ${expected.length})`
      );
    }
    const maxLen = Math.max(actual.length, expected.length);
    for (let i = 0; i < maxLen; i++) {
      diffs.push(...findDiffs(actual[i], expected[i], `${path}[${i}]`));
    }
    return diffs;
  }
  if (
    typeof actual === 'object' &&
    actual !== null &&
    typeof expected === 'object' &&
    expected !== null
  ) {
    const allKeys = new Set([
      ...Object.keys(actual as Record<string, unknown>),
      ...Object.keys(expected as Record<string, unknown>),
    ]);
    for (const key of allKeys) {
      const a = (actual as Record<string, unknown>)[key];
      const e = (expected as Record<string, unknown>)[key];
      if (a === undefined && e !== undefined) {
        diffs.push(
          `${path}.${key}: MISSING in actual (expected: ${JSON.stringify(e).slice(0, 100)})`
        );
      } else if (a !== undefined && e === undefined) {
        diffs.push(
          `${path}.${key}: EXTRA in actual (value: ${JSON.stringify(a).slice(0, 100)})`
        );
      } else {
        diffs.push(...findDiffs(a, e, `${path}.${key}`));
      }
    }
    return diffs;
  }
  if (actual !== expected) {
    diffs.push(
      `${path}: actual=${JSON.stringify(actual).slice(0, 80)} expected=${JSON.stringify(expected).slice(0, 80)}`
    );
  }
  return diffs;
}

for (const [agentFile, expectedFile] of FIXTURE_PAIRS) {
  describe(`parity: ${agentFile}`, () => {
    it(`should match ${expectedFile}`, () => {
      const source = readFixtureSource(agentFile);
      const { ast, diagnostics: parseDiagnostics } =
        parseWithDiagnostics(source);

      const parseErrors = errorDiagnostics(parseDiagnostics);
      expect(
        parseErrors,
        `Dialect parse errors in ${agentFile}:\n${formatDiagnostics(parseErrors)}`
      ).toEqual([]);

      const result = compile(ast);

      const compileErrors = errorDiagnostics(result.diagnostics);
      expect(
        compileErrors,
        `Compiler errors in ${agentFile}:\n${formatDiagnostics(compileErrors)}`
      ).toEqual([]);

      const expectedYaml = readExpectedYaml(expectedFile);
      const expected = yamlParse(expectedYaml);
      const actual = yamlParse(yamlStringify(result.output));

      const diffs = findDiffs(actual, expected, '');
      if (diffs.length > 0) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(
          `DIFFS for ${agentFile} → ${expectedFile} (${diffs.length} total):`
        );
        for (const d of diffs.slice(0, 50)) {
          console.log(`  ${d}`);
        }
        if (diffs.length > 50)
          console.log(`  ... and ${diffs.length - 50} more`);
        console.log('='.repeat(60));
      }
      expect(diffs).toEqual([]);
    });
  });
}
