import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export const EyeIcon = ({ className = "icon", ...props }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z"/><circle cx="12" cy="12" r="3"/></svg>
);

export const EyeOffIcon = ({ className = "icon", ...props }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20"/></svg>
);

export const CloudIcon = ({ className = "icon", ...props }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M12 12v9m-4-4 4-4 4 4"/></svg>
);

export const LockIcon = ({ className = "icon", ...props }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
);

export const FolderIcon = ({ className = "icon", ...props }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
);

export const ServerIcon = ({ className = "icon", ...props }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>
);

export const InfoIcon = ({ className = "icon", ...props }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>
);

export const TrashIcon = ({ className = "icon", ...props }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2m-9 5v6m4-6v6"/></svg>
);

export const XIcon = ({ className = "icon", ...props }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><path d="M18 6 6 18M6 6l12 12"/></svg>
);

export const CopyIcon = ({ className = "icon", ...props }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
);

export const CheckIcon = ({ className = "icon", ...props }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><path d="m9 11 3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
);

export const ImageIcon = ({ className = "icon", ...props }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
);
