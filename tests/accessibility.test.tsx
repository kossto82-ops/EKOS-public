// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import axe from 'axe-core';
import { Modal } from '../src/components/shared/Modal';
import { Breadcrumb } from '../src/components/shared/Breadcrumb';
import { ToastContainer } from '../src/components/shared/Toast';
import { LocaleProvider } from '../src/context/LocaleContext';

/**
 * Automated WCAG regression gate (docs/KNOWN_LIMITATIONS.md's "Continuous
 * Accessibility Testing" item). Scoped to shared primitives — Modal,
 * Breadcrumb, and the toast system — which are reused across most screens, so
 * a violation here is a violation everywhere they're used. This is a starting
 * gate, not full-app coverage; see docs/KNOWN_LIMITATIONS.md for what's
 * intentionally out of scope for now.
 *
 * Modal, Breadcrumb, and ToastContainer all resolve at least one label
 * through useLocale (Modal's default close-button aria-label included), so
 * every render below is wrapped in a LocaleProvider via the `withLocale`
 * helper. That is not test scaffolding around an awkward component: main.tsx
 * wraps the whole app in the same provider, so a bare, provider-less render
 * is a configuration that never occurs in production.
 */
const withLocale = (ui: React.ReactElement) => render(<LocaleProvider>{ui}</LocaleProvider>);
async function expectNoViolations(container: Element) {
  const results = await axe.run(container, {
    // jsdom has no real layout engine, so color-contrast can't be computed
    // meaningfully here — contrast is exercised by the manual/visual audit
    // process instead (see docs/ACCESSIBILITY.md).
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toHaveLength(0);
}

afterEach(cleanup);

describe('Accessibility — Modal (src/components/shared/Modal.tsx)', () => {
  it('has no axe violations in its default (div) rendering', async () => {
    const { container } = withLocale(
      <Modal titleId="test-modal-title" title="Confirm Action" icon={<span aria-hidden="true">!</span>} onClose={() => {}}>
        <p>Are you sure you want to proceed?</p>
      </Modal>
    );
    await expectNoViolations(container);
  });

  it('has no axe violations when rendered as a form (onSubmit provided)', async () => {
    const { container } = withLocale(
      <Modal
        titleId="test-modal-form-title"
        title="Report an Issue"
        icon={<span aria-hidden="true">!</span>}
        onClose={() => {}}
        onSubmit={(e) => e.preventDefault()}
      >
        <label htmlFor="issue-details">Details</label>
        <textarea id="issue-details" />
      </Modal>
    );
    await expectNoViolations(container);
  });

  it('exposes the expected dialog semantics', () => {
    const { getByRole } = withLocale(
      <Modal titleId="test-modal-title-2" title="Confirm Action" icon={<span aria-hidden="true">!</span>} onClose={() => {}}>
        <p>Body</p>
      </Modal>
    );
    const dialog = getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'test-modal-title-2');
  });
});

describe('Accessibility — Breadcrumb (src/components/shared/Breadcrumb.tsx)', () => {
  it('has no axe violations with clickable and terminal items', async () => {
    const { container } = withLocale(
      <Breadcrumb
        items={[
          { label: 'Home', onClick: () => {} },
          { label: 'Assistant', onClick: () => {} },
          { label: 'Current Page' },
        ]}
      />
    );
    await expectNoViolations(container);
  });

  it('marks the last item as the current page', () => {
    const { getByText } = withLocale(
      <Breadcrumb items={[{ label: 'Home', onClick: () => {} }, { label: 'Current Page' }]} />
    );
    expect(getByText('Current Page').closest('[aria-current]')).toHaveAttribute('aria-current', 'page');
  });
});

describe('Accessibility — ToastContainer (src/components/shared/Toast.tsx)', () => {
  it('has no axe violations once a toast is dispatched', async () => {
    const { container, findByRole } = withLocale(<ToastContainer />);
    fireEvent(
      window,
      new CustomEvent('portal_toast_event', {
        detail: { id: 't1', message: 'Saved successfully', type: 'success', duration: 5000 },
      })
    );
    await findByRole('alert');
    await expectNoViolations(container);
  });

  it('renders the live region so assistive tech announces new toasts', () => {
    const { container } = withLocale(<ToastContainer />);
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
  });
});
