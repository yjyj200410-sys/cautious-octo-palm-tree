import NavLink, { type NavLinkProps } from '../NavLink';

interface SideBarItems extends NavLinkProps {
  parentClassName: string;
  icon: string;
  content: string;
}

const SideBarItem = (props: SideBarItems) => {
  const { parentClassName, icon, content, className } = props;

  return (
    <NavLink
      {...props}
      className={`${
        parentClassName
      } ${className} text-font-color-black/70 hover:bg-background-color-1 dark:text-font-color-white dark:hover:bg-dark-background-color-1 [&.active]:bg-background-color-3! dark:[&.active]:bg-dark-background-color-3! dark:[&.active]:text-font-color-black! flex !h-10 shrink-0 cursor-pointer items-center rounded-full bg-[transparent] px-3 text-sm font-medium outline-offset-2 transition-[background] duration-300 focus-visible:!outline`}
    >
      <span className="material-icons-round icon mr-1.5 text-xl font-normal!">{icon}</span>
      <span className="whitespace-nowrap">{content}</span>
    </NavLink>
  );
};

export default SideBarItem;
