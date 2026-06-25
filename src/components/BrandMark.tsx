import kunoIcon from "../../src-tauri/icons/icon.png";
import clsx from "clsx";

type BrandMarkProps = {
  size?: "small" | "medium";
  className?: string;
};

export function BrandMark({ size = "small", className }: BrandMarkProps) {
  return (
    <span
      className={clsx(
        "kuno-brand-mark shrink-0",
        size === "small" ? "h-6 w-6" : "h-10 w-10",
        className
      )}
      aria-hidden="true"
    >
      <img src={kunoIcon} alt="" className="h-full w-full object-cover" />
    </span>
  );
}
