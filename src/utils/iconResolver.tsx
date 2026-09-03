/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Headset, PhoneCall, Users, GraduationCap, Building2, Server, TrendingUp,
  Megaphone, Calculator, Scale, FileText, Mail, ReceiptText, MailWarning,
  Bot, Settings, BookOpen, ShieldAlert, Compass, HelpCircle, Wrench,
  UserCheck, CheckCircle2, Sparkles, Layers, Library, HeartPulse,
} from 'lucide-react';

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Headset, PhoneCall, Users, GraduationCap, Building2, Server, TrendingUp,
  Megaphone, Calculator, Scale, FileText, Mail, ReceiptText, MailWarning,
  Bot, Settings, BookOpen, ShieldAlert, Compass, HelpCircle, Wrench,
  UserCheck, CheckCircle2, Sparkles, Layers, Library, HeartPulse,
};

/**
 * Resolves a Lucide icon string back to its React component.
 * Adding a new department/brand icon? Add its import above AND its
 * entry in ICON_MAP, or it will silently fall back to HelpCircle.
 */
export function resolveIcon(iconName: string, sizeOrProps: any = 'w-4 h-4'): React.ReactNode {
  let props: any = {};
  if (typeof sizeOrProps === 'string') {
    props = sizeOrProps.includes('w-') || sizeOrProps.includes('h-') || sizeOrProps.includes(' ')
      ? { className: sizeOrProps }
      : { size: parseInt(sizeOrProps) || 16 };
  } else if (sizeOrProps && typeof sizeOrProps === 'object') {
    props = sizeOrProps;
  }

  const IconComponent = ICON_MAP[iconName];
  if (IconComponent) return React.createElement(IconComponent, props);
  return React.createElement(HelpCircle, props);
}
