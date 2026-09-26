
import React, {useState} from 'react'


interface prop{
    //modalopen:boolean
    user:any
    onClose: () => void
}


const ChangePasswordModal = ({ user, onClose}: prop) => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleSubmit = () => {
  };

  return (
    <>
    {/* Modal content <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
      <div className="bg-white p-6 rounded-lg w-[350px]">
        <h2 className="text-lg font-semibold mb-3">Change Password</h2>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border p-2 rounded mb-2"
          placeholder="New password"
        />
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full border p-2 rounded mb-2"
          placeholder="Confirm password"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 bg-gray-200 rounded">
            Cancel
          </button>
          <button onClick={handleSubmit} className="px-4 py-2 bg-blue-600 text-white rounded">
            Save
          </button>
        </div>
      </div>
    </div>*/}


    <div className='fixed inset-0 z-50 flex  items-center justify-center bg-black/20'>
        <div className='lg:w-[400px] absolute w-[90%] h-[220px] bg-white rounded-[12px] flex flex-col gap-[20px] p-[24px]'>
          <h1 className='font-inter font-semibold '>Are you sure?</h1>
          <p className='font-inter text-[14px]'>You are about to reset password for  <span className='font-semibold'>{user.id}</span> This will send a default password to the Merchants email/SMS</p>

          <div className="flex justify-center  gap-[15px]">

            <button onClick={onClose} className='bg-white flex h-[40px] cursor-pointer w-[167px] border border-[#D0D5DD] rounded-[8px] items-center gap-[9px] justify-center'>
              <p className='text-[14px] font-inter font-semibold'>Cancel</p>
            </button>
            <button className='bg-[#4E37FB] flex h-[40px]  cursor-pointer w-[167px] rounded-[8px] items-center gap-[9px] justify-center'>
              <p className='text-[14px] font-inter text-white font-semibold'>Confirm</p>
            </button>

          </div>
        </div>
      </div>
    </>
  );
};
export default ChangePasswordModal
