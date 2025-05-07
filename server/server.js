exports = {
  // Install Hook
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
 
  // Scheduled Trigger
  onScheduledEventHandler: async function () {
    const fetchToken = //Fdk Token;
    const wifiAuth = //WifiAuth Token;
 
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
          await handleCheckIn(reservation, wifiAuth);
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
 
// Check-In Handler
async function handleCheckIn(reservation, wifiAuth) {
  try {
    if (reservation.booking_status === 'CHECKED_IN') {
      const guestshare = reservation.adult_count > 1 ? "Y" : "N";
      const actualCheckIn = reservation.actual_check_in ? reservation.actual_check_in.split('T') : [];
      const date = actualCheckIn.length > 0 ? actualCheckIn[0].slice(2).replace(/-/g, '') : '';
      const time = actualCheckIn.length > 1 ? actualCheckIn[1].split('.')[0].replace(/:/g, '') : '';
 
      const checkInPayload = {
        "roomno": reservation.room_number,
        "registrationno": reservation.reservation_no,
        "guestshare": guestshare,
        "guestname": `${reservation.guest_info.first_name} ${reservation.guest_info.last_name}`,
        "firstname": reservation.guest_info.first_name,
        "date": date,
        "time": time
      };
 
      console.log(checkInPayload);
 
      const checkInResponse = await $request.invokeTemplate("checkInGuest", {
        context: { Wifi_auth: wifiAuth },
        body: JSON.stringify(checkInPayload)
      });
 
      console.info("Check-In Success:", checkInResponse);
    } else {
      console.log(`Skipping check-in. Booking status is '${reservation.booking_status}'`);
    }
  } catch (error) {
    console.error("Check-In Error:", error);
  }
}
 
// Check-Out Handler
async function handleCheckOut(reservation, wifiAuth) {
  try {
    if (reservation.booking_status === 'CHECKED_OUT') {
      const guestshare = reservation.adult_count > 1 ? "Y" : "N";
      const actualCheckOut = reservation.actual_check_out ? reservation.actual_check_out.split('T') : [];
      const date = actualCheckOut.length > 0 ? actualCheckOut[0].slice(2).replace(/-/g, '') : '';
      const time = actualCheckOut.length > 1 ? actualCheckOut[1].split('.')[0].replace(/:/g, '') : '';
 
      const checkOutPayload = {
        "roomno": reservation.room_number,
        "registrationno": reservation.reservation_no,
        "guestshare": guestshare,
        "date": date,
        "time": time
      };
 
      console.log(checkOutPayload);
 
      const checkOutResponse = await $request.invokeTemplate("checkOutGuest", {
        context: { Wifi_auth: wifiAuth },
        body: JSON.stringify(checkOutPayload)
      });
 
      console.info("Check-Out Success:", checkOutResponse);
    } else {
      console.log(`Skipping check-out. Booking status is '${reservation.booking_status}'`);
    }
  } catch (error) {
    console.error("Check-Out Error:", error);
  }
}
 
 
