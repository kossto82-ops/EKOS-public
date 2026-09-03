/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

// ----------------------------------------------------------------------
// Reusable Enterprise-Grade UI Components
// ----------------------------------------------------------------------

// 1. Unified Button Component
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  icon?: React.ComponentType<{ className?: string }>;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'primary',
  size = 'sm',
  icon: Icon,
  className = '',
  children,
  ...props
}, ref) => {
  const baseClasses = "inline-flex items-center justify-center font-sans font-semibold tracking-tight transition-all duration-150 rounded-sm cursor-pointer select-none focus:outline-hidden disabled:opacity-50 disabled:pointer-events-none";
  
  const variantClasses = {
    primary: "bg-brand-600 hover:bg-brand-700 text-white shadow-xs focus:ring-2 focus:ring-brand-500/20 active:scale-98",
    secondary: "bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 focus:ring-2 focus:ring-brand-500/10 active:scale-98",
    ghost: "bg-transparent hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white active:scale-98",
    danger: "bg-danger-600 hover:bg-danger-700 text-white shadow-xs focus:ring-2 focus:ring-danger-500/20 active:scale-98",
    success: "bg-success-600 hover:bg-success-700 text-white shadow-xs focus:ring-2 focus:ring-success-500/20 active:scale-98",
  };

  const sizeClasses = {
    xs: "px-2 py-1 text-3xs gap-1",
    sm: "px-3 py-1.5 text-xs gap-1.5",
    md: "px-4 py-2 text-xs gap-2",
    lg: "px-5 py-2.5 text-sm gap-2.5",
  };

  return (
    <button
      ref={ref}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {Icon && <Icon className={`${size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5'} flex-shrink-0`} />}
      {children}
    </button>
  );
});

Button.displayName = 'Button';

// 2. Consistent Input Component
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ComponentType<{ className?: string }>;
  error?: string;
  label?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({
  icon: Icon,
  error,
  label,
  className = '',
  id,
  ...props
}, ref) => {
  return (
    <div className="flex flex-col gap-1 w-full">
      {label && (
        <label htmlFor={id} className="text-3xs uppercase font-bold text-slate-400 dark:text-slate-500 font-mono tracking-wider select-none">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {Icon && (
          <div className="absolute left-3 text-slate-400 pointer-events-none">
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
        <input
          ref={ref}
          id={id}
          className={`w-full rounded-sm border ${
            error ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20' : 'border-slate-200 dark:border-slate-900/80 focus:border-brand-500 focus:ring-brand-500/20'
          } bg-white dark:bg-slate-950 ${
            Icon ? 'pl-9 pr-3' : 'px-3'
          } py-2 text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:ring-1 focus:outline-hidden transition-all duration-150 ${className}`}
          {...props}
        />
      </div>
      {error && <span className="text-3xs text-danger-500 font-medium font-mono">{error}</span>}
    </div>
  );
});

Input.displayName = 'Input';

// 3. Consistent Select Dropdown
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  label?: string;
  options?: { value: string | number; label: string }[];
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({
  error,
  label,
  options,
  className = '',
  children,
  id,
  ...props
}, ref) => {
  return (
    <div className="flex flex-col gap-1 w-full">
      {label && (
        <label htmlFor={id} className="text-3xs uppercase font-bold text-slate-400 dark:text-slate-500 font-mono tracking-wider select-none">
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={id}
        className={`w-full rounded-sm border ${
          error ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20' : 'border-slate-200 dark:border-slate-900/80 focus:border-brand-500 focus:ring-brand-500/20'
        } bg-white dark:bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-zinc-200 focus:ring-1 focus:outline-hidden cursor-pointer transition-all duration-150 ${className}`}
        {...props}
      >
        {children || options?.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-slate-950 text-white text-xs">
            {opt.label}
          </option>
        ))}
      </select>
      {error && <span className="text-3xs text-danger-500 font-medium font-mono">{error}</span>}
    </div>
  );
});

Select.displayName = 'Select';

// 4. Consistent Textarea Input
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  label?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({
  error,
  label,
  className = '',
  id,
  ...props
}, ref) => {
  return (
    <div className="flex flex-col gap-1 w-full">
      {label && (
        <label htmlFor={id} className="text-3xs uppercase font-bold text-slate-400 dark:text-slate-500 font-mono tracking-wider select-none">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={id}
        className={`w-full rounded-sm border ${
          error ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20' : 'border-slate-200 dark:border-slate-900/80 focus:border-brand-500 focus:ring-brand-500/20'
        } bg-white dark:bg-slate-950 px-3 py-2 text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:ring-1 focus:outline-hidden transition-all duration-150 ${className}`}
        {...props}
      />
      {error && <span className="text-3xs text-danger-500 font-medium font-mono">{error}</span>}
    </div>
  );
});

Textarea.displayName = 'Textarea';

// 5. Clean Panel / Card Component
interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerAction?: React.ReactNode;
  noPadding?: boolean;
}

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  headerAction,
  noPadding = false,
  className = '',
  children,
  ...props
}) => {
  return (
    <div
      className={`bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-900 rounded-sm flex flex-col justify-between transition-colors duration-150 ${className}`}
      {...props}
    >
      {(title || subtitle || headerAction) && (
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-900">
          <div>
            {title && (
              <h3 className="text-xs font-bold font-sans text-slate-900 dark:text-white uppercase tracking-wider select-none">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-2xs text-slate-500 dark:text-slate-400 mt-1 select-none leading-relaxed">
                {subtitle}
              </p>
            )}
          </div>
          {headerAction && <div className="flex-shrink-0 ml-4">{headerAction}</div>}
        </div>
      )}
      <div className={noPadding ? '' : 'p-5 flex-1'}>
        {children}
      </div>
    </div>
  );
};

// 6. Clean Table Components
export const TableContainer: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', children, tabIndex, role, ...props }) => (
  <div
    tabIndex={tabIndex ?? 0}
    // Only claim the "region" landmark role when the caller gave it a name —
    // an unnamed region is its own axe violation (aria-label/aria-labelledby via ...props).
    role={role ?? (props['aria-label'] || props['aria-labelledby'] ? 'region' : undefined)}
    className={`overflow-x-auto w-full border border-slate-200 dark:border-slate-900 rounded-sm bg-white dark:bg-slate-950 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset ${className}`}
    {...props}
  >
    <table className="w-full border-collapse text-left text-xs text-slate-700 dark:text-zinc-300">
      {children}
    </table>
  </div>
);

export const TableHead: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ className = '', children, ...props }) => (
  <thead className={`bg-slate-50 dark:bg-slate-950/50 border-b border-slate-200 dark:border-slate-900 ${className}`} {...props}>
    {children}
  </thead>
);

export const TableBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ className = '', children, ...props }) => (
  <tbody className={`divide-y divide-slate-200 dark:divide-slate-900/60 ${className}`} {...props}>
    {children}
  </tbody>
);

export const TableRow: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({ className = '', children, ...props }) => (
  <tr className={`hover:bg-slate-50/50 dark:hover:bg-slate-900/20 transition-colors duration-100 ${className}`} {...props}>
    {children}
  </tr>
);

export const TableHeaderCell: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({ className = '', children, ...props }) => (
  <th className={`px-4 py-3 text-3xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 font-mono select-none ${className}`} {...props}>
    {children}
  </th>
);

export const TableCell: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({ className = '', children, ...props }) => (
  <td className={`px-4 py-3 align-middle font-medium border-slate-200 dark:border-slate-900 ${className}`} {...props}>
    {children}
  </td>
);

// 7. Compact Status Badge Component
// Derived from the convention already used byte-identically across the sync
// and settings health cards: `px-1.5 py-0.5 rounded-sm text-5xs font-mono
// font-bold uppercase tracking-wide` plus a semantic colour pair. Variants
// below map 1:1 onto the colour pairs actually in use at those call sites —
// no new palette was invented.
// Two appearances, because the codebase had two and only one of them was an
// accident. `solid` is the convention above. `outline` is the slightly larger,
// bordered treatment used by the header's brand chip, the policy scope chip and
// the review drawer — a deliberate second weight, not a fifth variation, so it
// is offered rather than flattened.
//
// `variant: 'inherit'` supplies no colour at all. The header's chip is coloured
// at runtime from the active brand (`style={{ color, borderColor, background }}`),
// so a fixed palette cannot express it; without this, migrating that call site
// would mean shipping variant classes that inline styles immediately override.
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'success' | 'warning' | 'danger' | 'brand' | 'neutral' | 'neutralMuted' | 'amber' | 'inherit';
  appearance?: 'solid' | 'outline';
  /**
   * Visual weight. Defaults to `sm`, the 8-9px chip used everywhere else —
   * right for a dense table, subordinate next to anything bigger. `lg` is for
   * the rare call site where a badge is the only status indicator on an
   * otherwise generously-sized screen and needs to read as a peer of that
   * scale, not a footnote to it. Only two steps: this is a prominence
   * affordance for an existing primitive, not a second size scale to maintain.
   */
  size?: 'sm' | 'lg';
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(({
  variant,
  appearance = 'solid',
  size = 'sm',
  className = '',
  children,
  ...props
}, ref) => {
  // Outline exists to carry colour — the header's brand chip, the policy scope
  // chip and the review drawer's priority chip all reach for it for that reason.
  // Neutral as its unstated default meant every call site had to override it to
  // get anything from Badge's own palette, so `inherit` (spelled out at three of
  // the four sites, because a runtime or ancestor-driven colour is a real need)
  // read as the norm rather than the exception it actually is. Solid keeps
  // neutral: it is the muted status-pill convention this was derived from, and
  // changing that default would recolour every existing solid badge in the app.
  const resolvedVariant: NonNullable<BadgeProps['variant']> =
    variant ?? (appearance === 'outline' ? 'brand' : 'neutral');

  // Geometry is composed, not overridden. The first version of `lg` appended
  // `!text-xs !px-2.5 !py-1` to win against the base string, which put !important
  // into a shared primitive so that a test regex would not have to change — the
  // tail wagging the dog, and the same class of same-property collision that made
  // the outline border colour undefined. There is one source of truth per size
  // now, and nothing here has to out-specify anything else.
  //
  // `lg` exists for the handful of places where a badge is the only status signal
  // on a generously sized screen (EnterpriseAnswer) rather than one cell among
  // many in a dense table, where the 8px default is right.
  const geometry =
    size === 'lg'
      ? 'px-2.5 py-1 gap-1.5 text-xs'
      : appearance === 'outline'
        ? 'px-1.5 py-0.5 gap-1 text-4xs'
        : 'px-1.5 py-0.5 gap-1 text-5xs';

  const chrome = appearance === 'outline'
    ? 'rounded-sm font-mono font-bold uppercase tracking-wider border select-none'
    : 'rounded-sm font-mono font-bold uppercase tracking-wide select-none';

  const baseClasses = `inline-flex items-center ${geometry} ${chrome}`;

  // In the outline appearance the border takes the text colour, so one colour
  // token drives all three surfaces and a variant cannot be half-applied.
  //
  // Except under `inherit`, which means the caller owns the colour — and that has
  // to include the border. Adding border-current here anyway put it in a
  // same-specificity fight with the caller's own border-* class, and Tailwind
  // resolves that by emission order rather than by the order written in the JSX,
  // so the rendered border colour was genuinely undefined. Callers that want the
  // border to follow the text colour now say `border-current` themselves.
  const border = appearance === 'outline' && resolvedVariant !== 'inherit' ? ' border-current' : '';

  const variantClasses: Record<NonNullable<BadgeProps['variant']>, string> = {
    success: "text-success-600 bg-success-50 dark:text-success-400 dark:bg-success-950/20",
    warning: "text-warning-600 bg-warning-50 dark:text-warning-400 dark:bg-warning-950/20",
    danger: "text-danger-600 bg-danger-50 dark:text-danger-400 dark:bg-danger-950/20",
    brand: "text-brand-600 bg-brand-50 dark:text-brand-400 dark:bg-brand-950/20",
    neutral: "text-zinc-500 bg-zinc-100 dark:text-zinc-400 dark:bg-zinc-800",
    neutralMuted: "text-zinc-500 bg-zinc-100 dark:text-zinc-400 dark:bg-zinc-800/40",
    amber: "text-amber-700 bg-amber-100 dark:text-amber-400 dark:bg-amber-950/30",
    inherit: "",
  };

  return (
    <span
      ref={ref}
      className={`${baseClasses}${border} ${variantClasses[resolvedVariant]} ${className}`.replace(/\s+/g, ' ').trim()}
      {...props}
    >
      {children}
    </span>
  );
});

Badge.displayName = 'Badge';

// 8. Standardized Empty State Component
interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /**
   * Element for the title. Defaults to `p`, deliberately.
   *
   * This used to be a hardcoded `h4`, and the first screen migrated onto the
   * component failed axe's heading-order rule for it: a shared primitive cannot
   * know how deeply it will be mounted, so a fixed level is a violation waiting
   * for the wrong parent. A call site that genuinely owns a section can pass a
   * level; the default cannot break the document outline.
   */
  titleAs?: 'h2' | 'h3' | 'h4' | 'p';
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
  titleAs: TitleTag = 'p',
  className = '',
  ...props
}) => {
  return (
    <div className={`flex flex-col items-center justify-center text-center p-8 border border-dashed border-slate-200 dark:border-slate-800/60 rounded-sm bg-slate-50/20 dark:bg-slate-950/10 min-h-[220px] transition-colors duration-150 ${className}`} {...props}>
      {/* No animate-pulse. A pulsing icon means "loading", and an empty state is
          the opposite — it is the settled answer that there is nothing here. It
          also broke tests/fullScreenAccessibility.test.tsx, which waits for
          .animate-pulse to clear before running axe so it audits the settled
          screen rather than a skeleton; a permanent pulse made that wait
          unsatisfiable on any screen showing this component. */}
      {Icon && <Icon className="h-8 w-8 text-slate-300 dark:text-slate-700 mb-3" />}
      <TitleTag className="text-xs font-bold text-slate-800 dark:text-zinc-200 uppercase tracking-wider font-mono mb-1 select-none">{title}</TitleTag>
      {description && <p className="text-2xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed mb-4 select-none">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
};

// 9. Blocking-surface scrim and stacking order
//
// Six different backdrops had grown for one concept. slate-950 at 45/65, at
// 40/60, at 30/60, at 30/40, at 40 with no dark pair and no blur, and one on a
// different colour entirely (slate-900/20). Overlapping surfaces therefore
// darkened the page by different amounts depending on which one opened, and a
// nested drawer could sit under a lighter scrim than the dialog behind it.
//
// These are class strings rather than a component because the surfaces position
// their scrim differently — a centered dialog uses `fixed inset-0`, a slide-over
// puts `absolute inset-0` inside its own fixed root — and only the appearance
// needs to be shared. Tailwind scans source text for candidates, so the literals
// below are extracted normally.

/** The scrim every blocking surface draws. Position it at the call site. */
export const OVERLAY_SCRIM = 'bg-slate-950/45 dark:bg-slate-950/65 backdrop-blur-xs';

/**
 * Stacking order, which is two layers and must stay two.
 *
 * Dialogs, drawers and their scrims all share OVERLAY_Z: they are mutually
 * exclusive or deliberately stacked by DOM order, and giving one a private
 * z-index is how a drawer ends up behind its own backdrop.
 *
 * LOCKSCREEN_Z is above them because a lock screen that a dialog can cover is
 * not a lock screen. It is the only value in the app that needs to outrank the
 * dialog layer, and anything else reaching for a third scale is a bug.
 */
export const OVERLAY_Z = 'z-50';
export const LOCKSCREEN_Z = 'z-[10000]';
