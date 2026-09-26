"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import Image from "next/image"

interface ActionMenuProps {
    rowId: string
    onEditDetails: () => void
    reset:() => void
    status:() => void
    Delete:() => void
}

const ActionMenu: React.FC<ActionMenuProps> = ({ onEditDetails, reset, status, Delete }) => {
    const [isOpen, setIsOpen] = useState(false)
    const [showAbove, setShowAbove] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }

        const handleResize = () => {
            if (buttonRef.current && menuRef.current) {
                const buttonRect = buttonRef.current.getBoundingClientRect()
                const spaceBelow = window.innerHeight - buttonRect.bottom
                const menuHeight = menuRef.current.offsetHeight
                setShowAbove(spaceBelow < menuHeight && buttonRect.top > menuHeight)
            }
        }

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside)
            window.addEventListener("resize", handleResize)
            handleResize()
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside)
            window.removeEventListener("resize", handleResize)
        }
    }, [isOpen])

    const handleToggle = () => {
        setIsOpen(!isOpen)
    }

    return (
        <div className="relative " ref={menuRef}>
            <button
                ref={buttonRef}
                className="group transition-all outline-none duration-500 flex items-center"
                onClick={handleToggle}
                aria-haspopup="true"
                aria-expanded={isOpen}
            >
                <Image src="/icons/dots.svg" alt="dots" width={20} height={20} />
            </button>
            {isOpen && (
                <div className="absolute right-0 mt-2 bg-white shadow-lg rounded-md z-50"
                    role="menu"
                    aria-orientation="vertical"
                    aria-labelledby="options-menu"
                >
                    <div className="py-1 flex flex-col" role="none">
                        <button
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                            role="menuitem"
                            onClick={() => {
                                onEditDetails()
                                setIsOpen(false)
                            }}
                        >
                            Edit Details
                        </button>
                       <button
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                            role="menuitem"
                            onClick={() => {
                                status()
                                setIsOpen(false)
                            }}
                        >
                           Change Status
                        </button>
                        <button
                            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100 hover:text-red-700"
                            role="menuitem"
                            onClick={() => {
                                reset()
                                setIsOpen(false)
                            }}
                        >
                            Reset Password
                        </button>

                         <button
                            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100 hover:text-red-700"
                            role="menuitem"
                            onClick={() => {
                                Delete()
                                setIsOpen(false)
                            }}
                        >
                            Delete
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default ActionMenu

