import React, { createContext, useContext } from 'react';
import Markdown, { Components, ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isSafeLinkHref } from '../utils/markdown.ts';

type HastNode = NonNullable<ExtraProps['node']>['children'][number];

// The item's own text, without nested lists, used as its checkbox label.
const ownText = (node: HastNode): string =>
  node.type === 'text'
    ? node.value
    : node.type === 'element' && node.tagName !== 'ul' && node.tagName !== 'ol'
    ? node.children.map(ownText).join('')
    : '';

// The nearest list item, so its checkbox knows which source line to flip and how to label itself.
const ListItemLine = createContext<{ line: number; label: string } | null>(null);

const TaskCheckbox: React.FC<{ checked: boolean; onToggle?: (line: number) => void }> = ({
  checked,
  onToggle,
}) => {
  const item = useContext(ListItemLine);
  return (
    <input
      type="checkbox"
      checked={checked}
      aria-label={item?.label || 'Checklist item'}
      disabled={!onToggle || item === null}
      onChange={() => item && onToggle?.(item.line)}
      className="mr-1.5 align-middle accent-primary-600 cursor-pointer disabled:cursor-default"
    />
  );
};

function buildComponents(onToggleCheckbox?: (line: number) => void): Components {
  return {
    h1: ({ node, ...props }) => <h2 className="font-bold text-lg text-zinc-900 dark:text-zinc-100 pt-1" {...props} />,
    h2: ({ node, ...props }) => <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100 pt-1" {...props} />,
    h3: ({ node, ...props }) => <h4 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 pt-1" {...props} />,
    h4: ({ node, ...props }) => <h5 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100" {...props} />,
    h5: ({ node, ...props }) => <h6 className="font-semibold text-sm text-zinc-700 dark:text-zinc-300" {...props} />,
    h6: ({ node, ...props }) => <h6 className="font-semibold text-xs text-zinc-700 dark:text-zinc-300" {...props} />,
    ul: ({ node, className, ...props }) => (
      <ul
        className={className?.includes('contains-task-list') ? 'pl-1 space-y-0.5' : 'list-disc pl-5 space-y-0.5 marker:text-primary-500'}
        {...props}
      />
    ),
    ol: ({ node, className, ...props }) => (
      <ol
        className={className?.includes('contains-task-list') ? 'pl-1 space-y-0.5' : 'list-decimal pl-5 space-y-0.5 marker:text-primary-500'}
        {...props}
      />
    ),
    li: ({ node, className, ...props }) => (
      <ListItemLine.Provider
        value={node?.position ? { line: node.position.start.line, label: node.children.map(ownText).join('').trim() } : null}
      >
        <li className={className?.includes('task-list-item') ? 'list-none [&_ul]:pl-5' : undefined} {...props} />
      </ListItemLine.Provider>
    ),
    input: ({ node, type, checked }) =>
      type === 'checkbox' ? <TaskCheckbox checked={Boolean(checked)} onToggle={onToggleCheckbox} /> : null,
    a: ({ node, href, children }) =>
      isSafeLinkHref(href) ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary-600 dark:text-primary-400 underline underline-offset-2 hover:text-primary-500"
        >
          {children}
        </a>
      ) : (
        <span>{children}</span>
      ),
    blockquote: ({ node, ...props }) => (
      <blockquote className="border-l-2 border-zinc-300 dark:border-zinc-600 pl-3 text-zinc-500 dark:text-zinc-400" {...props} />
    ),
    code: ({ node, ...props }) => (
      <code className="px-1 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-700/60 font-mono text-[0.85em]" {...props} />
    ),
    pre: ({ node, ...props }) => (
      <pre
        className="p-3 rounded-lg bg-zinc-100 dark:bg-zinc-800 overflow-x-auto text-xs font-mono [&>code]:bg-transparent [&>code]:p-0"
        {...props}
      />
    ),
    hr: () => <hr className="border-zinc-200 dark:border-zinc-700" />,
    table: ({ node, ...props }) => <table className="text-xs border-collapse" {...props} />,
    th: ({ node, ...props }) => <th className="border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-left" {...props} />,
    td: ({ node, ...props }) => <td className="border border-zinc-300 dark:border-zinc-700 px-2 py-1" {...props} />,
  };
}

/** Renders task notes as GitHub-flavoured markdown. Task-list checkboxes call `onToggleCheckbox` with their source line. */
export const MarkdownNotes: React.FC<{
  text: string;
  onToggleCheckbox?: (line: number) => void;
}> = ({ text, onToggleCheckbox }) => (
  <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-200 leading-relaxed break-words">
    <Markdown remarkPlugins={[remarkGfm]} components={buildComponents(onToggleCheckbox)}>
      {text}
    </Markdown>
  </div>
);
