exports = {
  onAppInstallHandler: async function () {
    const datetime = new Date();

    try {
      console.info('onAppInstallHandler invoked');

      const data = await $schedule.create({
        name: "Scheduled call to HK",
        data: { event_info: "app_install" },
        schedule_at: datetime,
        repeat: {
          time_unit: "minutes",
          frequency: 30
        }
      });

      console.info("Schedule created:", JSON.stringify(data));
    } catch (error) {
      console.error("Error creating schedule:", error);
    }

    try {
      const updated = await $schedule.update({
        name: "Scheduled call to HK",
        data: { event_info: "app_install" },
        schedule_at: datetime,
        repeat: {
          time_unit: "minutes",
          frequency: 20
        }
      });

      console.info("Schedule updated:", JSON.stringify(updated));
    } catch (error) {
      console.error("Error updating schedule:", error);
    }

    renderData();
  },

  onScheduledEventHandler: async function () {
    const fetchToken = "MzRjYzc2ZTktZTVkNS00ZWI1LWFkNmQtZWEyOTQ0Mzc5NTBmOjc3YzA2NDYwLWQxNGEtNDI2Yi05Y2U3LTY0YTViOThhYzM1MQ==";
    const wifiAuth = "YWRtaW5pc3RyYXRvcjphZG1pbmlzdHJhdG9y";
    const crmAuth = "2XEZzhxZ_UsHBEH9V7bdYg ";

    try {
      const res = await $request.invokeTemplate("getLeads", {
        context: { encodedToken: fetchToken }
      });

      const hkArray = JSON.parse(res.response);
      console.info("HotelKey Response:", hkArray, hkArray[0]["payload"]);

      for (const event of hkArray) {
        const reservation = event.payload?.reservation;
        const propertyCode = event.payload?.property_code;

        if (propertyCode !== '7004') {
          console.info(`Skipping event due to unmatched property_code: ${propertyCode}`);
          continue;
        }

        if (reservation && reservation.guest_info) {
          await handleCheckIn(reservation, wifiAuth, crmAuth);
          await handleCheckOut(reservation, wifiAuth);
        } else {
          console.info("Skipping invalid reservation payload:", event);
        }
      }
    } catch (error) {
      console.error("Error in onScheduledEventHandler:", error);
    }
  }
};

// Util: Unique code generator
const used = new Set();
const generateUniqueCode = () => {
  if (used.size === 9000) throw "All 4-digit codes used";
  let code;
  do code = Math.floor(Math.random() * 9000) + 1000;
  while (used.has(code));
  used.add(code);
  return code;
};

// CRM Search by Phone
async function searchCrmContactByPhone(phoneNumber) {
  try {
    const response = await $request.invokeTemplate("searchCRMByPhone", {
      body: JSON.stringify({ phoneNumber }) // Sending payload in body
    });
    return JSON.parse(response.response);
  } catch (error) {
    console.error("Error searching CRM contact:", error);
    return [];
  }
}

// CRM Update by Phone
async function updateCrmContactByPhone(phoneNumber, registrationno, crmAuth) {
  try {
    const payload = {
      "mobile_number": phoneNumber,
      "registrationno": registrationno
    };

    const response = await $request.invokeTemplate("updateCRMContactByPhone", {
      context: { crmAuth },
      body: JSON.stringify(payload) // Sending payload in body
    });

    return response;
  } catch (error) {
    console.error("Error updating CRM contact:", error);
    return null;
  }
}

// Check-In Logic
async function handleCheckIn(reservation, wifiAuth, crmAuth) {
  try {
    if (reservation.booking_status === 'CHECKED_IN') {
      const actualCheckIn = reservation.actual_check_in ? reservation.actual_check_in.split('T') : [];
      const date = actualCheckIn.length > 0 ? actualCheckIn[0].slice(2).replace(/-/g, '') : '';
      const time = actualCheckIn.length > 1 ? actualCheckIn[1].split('.')[0].replace(/:/g, '') : '';

      for (let i = 0; i < reservation.adult_count; i++) {
        const guestshare = i === 0 ? "N" : "Y";
        const uniqueCode = generateUniqueCode();
        const registrationWithCode = `${reservation.reservation_no}${uniqueCode}`;

        const checkInPayload = {
          "roomno": reservation.room_number,
          "registrationno": registrationWithCode,
          "guestshare": guestshare,
          "guestname": `${reservation.guest_info.first_name} ${reservation.guest_info.last_name}`,
          "firstname": reservation.guest_info.first_name,
          "date": date,
          "time": time
        };
        console.log(checkInPayload);

        const checkInResponse = await $request.invokeTemplate("checkInGuest", {
          context: { Wifi_auth: wifiAuth },
          body: JSON.stringify(checkInPayload) // Sending payload in body 
        });

        console.info("Check-In Success:", checkInResponse);

        // ✅ Only proceed to CRM update if check-in to WiFi server was successful
        if (checkInResponse && checkInResponse.success) {
          const mobileNumber = reservation.guest_info.phone;
          const crmData = await searchCrmContactByPhone(mobileNumber);

          if (crmData && crmData.length > 0) {
            const crmContact = crmData.find(contact => contact.phone_number === mobileNumber);

            if (crmContact) {
              // Use crmAuth here correctly
              const crmUpdateResponse = await updateCrmContactByPhone(mobileNumber, registrationWithCode, crmAuth);
              console.info("CRM Update Success:", crmUpdateResponse);
            } else {
              console.info("No matching CRM contact found for mobile number:", mobileNumber);
            }
          } else {
            console.info("No CRM data found for mobile number:", mobileNumber);
          }
        } else {
          console.warn("Skipping CRM update. WiFi check-in failed.");
        }
      }
    } else {
      console.log(`Skipping check-in. Booking status is '${reservation.booking_status}'`);
    }
  } catch (error) {
    console.error("Check-In Error:", error);
  }
}


// Check-Out Logic
async function handleCheckOut(reservation, wifiAuth) {
  try {
    if (reservation.booking_status === 'CHECKED_OUT') {
      const actualCheckOut = reservation.actual_check_out ? reservation.actual_check_out.split('T') : [];
      const date = actualCheckOut.length > 0 ? actualCheckOut[0].slice(2).replace(/-/g, '') : '';
      const time = actualCheckOut.length > 1 ? actualCheckOut[1].split('.')[0].replace(/:/g, '') : '';

      const mobileNumber = reservation.guest_info.phone;
      const crmData = await searchCrmContactByPhone(mobileNumber);

      if (crmData && crmData.length > 0) {
        const crmContact = crmData.find(contact => contact.phone_number === mobileNumber);

        if (crmContact) {
          const registrationNo = crmContact.registrationno;

          if (registrationNo.startsWith(reservation.reservation_no)) {
            for (let i = 0; i < reservation.adult_count; i++) {
              const guestshare = i === 0 ? "N" : "Y";

              const checkOutPayload = {
                "roomno": reservation.room_number,
                "registrationno": registrationNo,
                "guestshare": guestshare,
                "date": date,
                "time": time
              };
              console.log(checkOutPayload);


              const checkOutResponse = await $request.invokeTemplate("checkOutGuest", {
                context: { Wifi_auth: wifiAuth },
                body: JSON.stringify(checkOutPayload) // Sending payload in body
              });

              console.info("Check-Out Success:", checkOutResponse);
            }
          } else {
            console.warn("CRM registration number doesn't match reservation prefix.");
          }
        } else {
          console.warn("No matching CRM contact for check-out.");
        }
      } else {
        console.warn("No CRM data found for phone number during check-out.");
      }
    } else {
      console.log(`Skipping check-out. Booking status is '${reservation.booking_status}'`);
    }
  } catch (error) {
    console.error("Check-Out Error:", error);
  }
}
