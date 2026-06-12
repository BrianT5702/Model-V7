import React from 'react';

export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function formControlClass(error = false, className = '') {
  return cn('form-control', error && 'form-control-error', className);
}

export function FormSection({ title, action, children, className = '' }) {
  return (
    <section className={cn('form-section', className)}>
      {(title || action) && (
        <div className="form-section-header">
          {title ? <h4 className="form-section-title">{title}</h4> : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function FormField({ label, htmlFor, hint, error, children, className = '' }) {
  return (
    <div className={cn('form-field', className)}>
      {label && (
        <label className="form-label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? <p className="form-error">{error}</p> : hint ? <p className="form-hint">{hint}</p> : null}
    </div>
  );
}

export function FormInput({ error = false, className = '', ...props }) {
  return <input className={formControlClass(error, className)} {...props} />;
}

export function FormSelect({ error = false, className = '', children, ...props }) {
  return (
    <select className={formControlClass(error, className)} {...props}>
      {children}
    </select>
  );
}

export function FormTextarea({ error = false, className = '', ...props }) {
  return <textarea className={cn('form-textarea', error && 'form-control-error', className)} {...props} />;
}

export function FormModalHeader({ title, subtitle, onClose, onMinimize, children }) {
  return (
    <div className="form-modal-header">
      <div className="min-w-0 flex-1 pr-2">
        <h2 className="form-modal-title">{title}</h2>
        {subtitle && <p className="form-modal-subtitle">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {children}
        {onMinimize && (
          <button type="button" onClick={onMinimize} className="form-icon-btn" title="Minimize" aria-label="Minimize">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} className="form-icon-btn" aria-label="Close">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

export function FormActions({ children, className = '' }) {
  return <div className={cn('form-actions', className)}>{children}</div>;
}
