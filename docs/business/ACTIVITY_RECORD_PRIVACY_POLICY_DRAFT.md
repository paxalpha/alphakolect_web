# Activity Record Privacy Policy Draft

**Status: owner-approved policy for P5.** This document records the owner's decisions for the P5 activity-record controls and the operator copy process. It is not legal advice and does not replace any notice required by applicable law. It is not the user-facing privacy notice; that notice remains assigned to P13.

## What Is Recorded

AlphaKolect records activity needed to investigate break-ins and suspicious activity and to help settle disputes. The activity record can include sign-ins, security outcomes, and actions that change permissions or business settings. An entry may identify the event and time, the person and membership involved, the affected business or item, an allowlisted event summary, the IP address, the user agent (browser or device information), and a server-generated request reference. The record does not include passwords, authentication tokens, or request bodies.

IP address and user-agent details may also be held with sign-in sessions and one-time links. These details are not exposed through the application to users.

## Who Can See Activity

The screens that show the activity record are not built yet; until they are, no one can view it in the application. When they are built, access is as follows.

- A business owner can see activity for that owner's business, including refused attempts and activity filtered to a person in that business.
- A business owner cannot see another business's activity. Activity performed by the AlphaKolect platform team may appear in the business record as “AlphaKolect team”; the platform worker's IP address and user agent are not shown to the business.
- The super administrator can use the platform activity record. Platform staff, including staff granted other platform permissions, cannot see IP addresses or user-agent details.
- Staff and agents do not have access to the business activity record. The record itself is available only through permission-checked and audited reads.

## Retention And Deletion

Each activity entry, including its IP address and user agent, is kept for two years and then deleted in full. This rule applies to records already stored as well as new records. Related IP/user-agent fields on ended sessions and used or expired one-time links are cleared after the same two-year period; the underlying identity/session/link records remain where other records refer to them.

A requested copy contains only the entries due for deletion at the time it is generated. Those entries remain held until the owner confirms receipt in writing; other entries continue to follow their normal retention date. The owner may cancel a request in writing. If a copy has waited seven days for the owner's written receipt, the owner is reminded; nothing is deleted on a reminder.

Backups are planned to be retained for 35 days. A backup taken before deletion may still contain an entry until that backup expires; after the backup retention period, it should no longer be present in any retained backup. Backup implementation and verification are assigned to P15 and are not established by this P5 document.

How often: the clean-up is run by hand by the operator once a month, on the first working day, until scheduled runs exist (P12), as decided by the owner on 18 October 2026.

Money records and all other records remain subject to the separate business rule that they are retained indefinitely; this activity-record exception does not change that rule.

## Requested Copy

The owner may request a copy of the entries due for deletion. The operator creates it on a temporary, private local volume that is encrypted, owner-only, not synced or backed up, and outside the application server and source repository. The operator hands the copy directly to the owner on a separate removable medium after writing and verifying it following physical eject and reinsertion. The owner provides a written receipt identifying the handover and report hash before the entries are released for deletion.

The operator destroys and verifies the temporary copy as soon as the written receipt is recorded. The system does not retain a report copy. The owner is responsible for the copy after receipt and may retain it for as long as the owner decides. If a report or medium is lost or the operator copy cannot be verified as destroyed, the operator records the loss or outstanding state and notifies the owner; the affected entries are not treated as delivered without the written receipt.

## Owner Approval

Owner approval of this draft: Mayowa Edward Fadahunsi  Date: 18th of October, 2026

Approval applies to the wording above only. Any material change to collection, access, retention, backup handling, or report delivery requires renewed review.
