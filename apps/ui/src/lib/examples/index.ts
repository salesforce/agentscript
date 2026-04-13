/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import helloWorld from './hello_world.agent?raw';
import weather from './weather.agent?raw';
import caseEscalation from './case_escalation_bot.agent?raw';
import orderTracking from './order_tracking_assistant.agent?raw';
import leadQualification from './lead_qualification_bot.agent?raw';

export interface ExampleScript {
  name: string;
  description: string;
  content: string;
}

export const EXAMPLE_SCRIPTS: ExampleScript[] = [
  {
    name: 'Hello World',
    description: 'A simple greeting agent — good starting point.',
    content: helloWorld,
  },
  {
    name: 'Weather Assistant',
    description:
      'Multi-topic agent with variables, conditionals, and transitions.',
    content: weather,
  },
  {
    name: 'Case Escalation Bot',
    description:
      'Customer service agent with identity verification and escalation.',
    content: caseEscalation,
  },
  {
    name: 'Order Tracking Assistant',
    description: 'E-commerce agent for tracking orders and processing returns.',
    content: orderTracking,
  },
  {
    name: 'Lead Qualification Bot',
    description: 'B2B sales agent using BANT criteria to qualify leads.',
    content: leadQualification,
  },
];
