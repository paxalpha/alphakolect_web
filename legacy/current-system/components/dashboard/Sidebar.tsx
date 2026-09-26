
import React, { useState, useEffect } from 'react'
import { Sidemenuitems } from './sidebarmenuitems'
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';


interface DashboardHeaderProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

/** Returns the permission level for a given key, or null if no restrictions (merchant). */
function getPermission(permissions: Record<string, string> | null, key: string | undefined): string | null {
  if (!permissions || !key) return 'Can edit'; // merchant: full access
  return permissions[key] ?? "Can't view";
}

const DashBoardSidebar = ({ isOpen, setIsOpen }: DashboardHeaderProps) => {

  const pathName = usePathname();

  // Read staff permissions from localStorage (set on collaborator/staff login)
  const [staffPermissions, setStaffPermissions] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    const checkPermissions = () => {
      try {
        const userType = localStorage.getItem('userType');
        const stored = localStorage.getItem('staffPermissions');
        if (userType === 'collaborator' && stored) {
          setStaffPermissions(JSON.parse(stored));
        } else {
          setStaffPermissions(null);
        }
      } catch {
        setStaffPermissions(null);
      }
    };
    checkPermissions();
    window.addEventListener('storage', checkPermissions);
    return () => window.removeEventListener('storage', checkPermissions);
  }, []);

  // Filter sidebar items based on staff permissions
  const visibleItems = Sidemenuitems.filter((item) => {
    const perm = getPermission(staffPermissions, item.permissionKey);
    return perm !== "Can't view";
  });

  // Find the index of the submenu that matches the current path
  const initialMenuOpen = React.useMemo(() => {
    const submenuIndex = visibleItems.findIndex(item =>
      item.submenu && item.submenuitems?.some(sub => sub.path === pathName)
    );
    return submenuIndex !== -1 ? submenuIndex : null;
  }, [pathName, visibleItems]);

  const [menuOpen, setMenuOpen] = useState<number | null>(initialMenuOpen);
  const [activeSubmenu, setActiveSubmenu] = useState<number | null>(initialMenuOpen);

  return (
   <>
    {/* Overlay backdrop */}
      {isOpen && window.innerWidth < 1024 && (
        <div
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 bg-black/20 backdrop-blur-md z-40 lg:hidden"
        />
      )}
      <div className={`fixed top-0 left-0 h-screen pt-20  transition-transform w-[264px] z-40 bg-[#150E46] text-[#E9E6FF] shadow-md ${isOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static lg:block`}>
   <div className="flex flex-col gap-[8px] antialiased font-inter font-normal h-full overflow-y-auto pb-8 px-3">
      {visibleItems.map((items, index) => {
  return (
    <React.Fragment key={index}>
      {items.submenu ? (
        <div className=' flex flex-col cursor-pointer' >
          <div className={`flex items-center gap-[12px] min-h-[40px] py-2 px-4 ${activeSubmenu === index ? "bg-[#0D0264] rounded-md text-white" : ""}`} onClick={() => {
            setMenuOpen(menuOpen === index ? null : index);
            setActiveSubmenu(activeSubmenu === index ? null : index);
          }}>
             <Image src={items.icon} alt={items.title + " icon"}  width={13} height={13} />
            <span className='text-[14px] leading-6 '>{items.title}</span>
           {menuOpen === index ?<Image src="/icons/arrowup.png" alt='arrowup' width={12}
            height={12}
             className='ml-auto mr-2'
              /> :   <Image src="/icons/arrowdown.png" alt='arrowdown' width={12}
            height={12}
             className='ml-auto mr-2'
              />}
          </div>

          {menuOpen === index && <div className='flex flex-col pt-2'>
            {items.submenuitems?.map((item, index) =>{
              return (
             <Link key={index} href={item.path} className={`flex items-center gap-[12px] min-h-[40px] py-2 px-4 ${item.path === pathName ? "bg-[#7A69FC] text-white rounded-md" : ""}`}>
          <Image src={item.icon} alt={item.title + " icon"}  width={12} height={12}/>
          <span className='text-[14px] leading-6 antialiased'>{item.title}</span>
        </Link>
              )
            })
            }
          </div>}
        </div>
      ) : (
        <Link href={items.path} className={`flex items-center gap-[12px] min-h-[40px] py-2 px-4 ${items.path === pathName ? "bg-[#7A69FC] text-white rounded-md" : ""}`}>
          <Image src={items.icon} alt={items.title + " icon"} className='my-[auto]' width={13} height={13} />
          <span className='leading-[24px]  text-[14px] my-[auto] antialiased'>{items.title}</span>
        </Link>
      )}
    </React.Fragment>
  );
})
}
       
     </div>
   </div>
   </>
  )
}

export default DashBoardSidebar