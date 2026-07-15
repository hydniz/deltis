import { Spinner } from './Spinner';

// Unified button. Variants map to the component classes in index.css so the
// same look is available for rare raw-markup cases (e.g. <label> as button).

const VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

const SIZES = {
  sm: '!px-4 !py-1.5 !text-xs',
  md: '',
  lg: '!px-7 !py-3 !text-base',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  children,
  className = '',
  disabled,
  type = 'button',
  ...rest
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading
        ? <Spinner size="xs" contrast={variant === 'primary'} />
        : Icon && <Icon size={size === 'sm' ? 13 : 15} className="flex-shrink-0" />}
      {children}
    </button>
  );
}
