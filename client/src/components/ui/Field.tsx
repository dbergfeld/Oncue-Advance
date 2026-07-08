import React from "react";

interface FieldWrapperProps {
  label: string;
  className?: string;
  children: React.ReactNode;
  required?: boolean;
}

export function FieldWrapper({ label, className = "", children, required }: FieldWrapperProps) {
  return (
    <label className={`block ${className}`}>
      <span className="oc-label">
        {label}
        {required && <span className="text-status-missing"> *</span>}
      </span>
      {children}
    </label>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
  type?: string;
}

export function TextField({ label, value, onChange, placeholder, className, required, type = "text" }: TextFieldProps) {
  return (
    <FieldWrapper label={label} className={className} required={required}>
      <input
        type={type}
        className="oc-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldWrapper>
  );
}

interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
}

export function TextAreaField({ label, value, onChange, placeholder, className, rows = 3 }: TextAreaFieldProps) {
  return (
    <FieldWrapper label={label} className={className}>
      <textarea
        className="oc-textarea"
        value={value}
        placeholder={placeholder}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldWrapper>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
}

export function SelectField({ label, value, onChange, options, className }: SelectFieldProps) {
  return (
    <FieldWrapper label={label} className={className}>
      <select className="oc-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldWrapper>
  );
}

interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

export function CheckboxField({ label, checked, onChange, className = "" }: CheckboxFieldProps) {
  return (
    <label className={`flex items-center gap-2 ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-surface-border bg-surface-raised text-accent accent-accent focus:ring-accent/40"
      />
      <span className="text-sm text-neutral-300">{label}</span>
    </label>
  );
}
